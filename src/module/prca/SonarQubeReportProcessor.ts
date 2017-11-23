/// <reference path="../../../typings/index.d.ts" />
///<reference path="../../../typings/globals/node/index.d.ts"/>
import tl = require('vsts-task-lib/task');
import * as fs from 'fs';
import * as path from 'path';

import {exec} from 'ts-process-promises';

import {PRInjectorError} from './PRInjectorError';
import {Message} from './Message';
import {ILogger} from './ILogger';
import {ISonarQubeReportProcessor} from './ISonarQubeReportProcessor';
import {Process} from 'process';
import {WriteableStream} from 'process';
import {ISeverityService} from './ISeverityService';


/**
 * Responsible for parsing the SQ file containg the issues and the paths
 *
 * @export
 * @class SonarQubeReportProcessor
 * @implements {ISonarQubeReportProcessor}
 */

export class SonarQubeReportProcessor implements ISonarQubeReportProcessor {
    private logger: ILogger;

    private severityService: ISeverityService;
    private sonarQubeUrl: string;

    constructor(logger: ILogger, severityService: ISeverityService, sonarQubeUrl: string) {
        if (!logger) {
            throw new ReferenceError('logger');
        }

        this.logger = logger;
        this.severityService = severityService;
        this.sonarQubeUrl = sonarQubeUrl;
    }

    /* Interface methods */

    public async FetchCommentsFromReport(reportPath: string): Promise<Message[]> {
        let startTime = new Date().getTime();

        if (!reportPath) {
            throw new ReferenceError('reportPath');
        }

        try {
            fs.accessSync(reportPath, fs.F_OK);
        } catch (e) {
            throw new PRInjectorError('Could not find ' + reportPath + ' - did the SonarQube analysis complete?');
        }

        let sqReportContent: string = fs.readFileSync(reportPath, 'utf8');
        var sonarQubeReport: any;

        try {
            sonarQubeReport = JSON.parse(sqReportContent);
        } catch (e) {
            throw new PRInjectorError('Could not parse the SonarQube report file. The error is: ' + e.message);
        }

        let componentMap = this.buildComponentMap(sonarQubeReport);
        let messages = await this.buildMessages(sonarQubeReport, componentMap);
        let endTime = new Date().getTime();

        this.logger.LogInfo(`[SonarQubetReportPRocessor] took ${endTime - startTime} ms to fetch comments from sonar report`);
        return messages;
    }

    /* Helper methods */

    private buildComponentMap(sonarQubeReport: any): Map<string, string> {
        let map: Map<string, string> = new Map();

        if (!sonarQubeReport.components) {
            this.logger.LogInfo('The SonarQube report is empty as it lists no components');
            return map;
        }
        this.logger.LogDebug(`[SonarQubeReportProcessor]buildComponentMap sonarQubeReport.components.length is [${sonarQubeReport.components.length}]`);

        for (var component of sonarQubeReport.components) {
            if (!component.key) {
                throw new PRInjectorError('Invalid SonarQube report - some components do not have keys');
            }

            if (component.path != null) {
                let componentPath: string = component.path;


                this.logger.LogDebug(`[SonarQubeReportProcessor] component.path is [${componentPath}] for module key [${component.moduleKey}] `);
                if (component.moduleKey != null) { // if the component belongs to a module, we need to prepend the module path
                    // #TODO: Support nested modules once the SonarQube report correctly lists moduleKey in nested modules
                    var buildModule: any = this.getObjectWithKey(sonarQubeReport.components, component.moduleKey);
                    this.logger.LogDebug(`[SonarQubeReportProcessor] buildModule.path is [${buildModule.path}] for module key [${component.moduleKey}] `);
                    if (buildModule.path != null) { // some modules do not list a path
                        componentPath = path.join(buildModule.path, component.path);
                    }
                }

                map.set(component.key, '/' + componentPath); // the PR file paths have a leading separator
            }
        }

        this.logger.LogDebug(`The SonarQube report contains ${map.size} components with paths`);

        return map;
    }

    private async buildMessages(sonarQubeReport: any, componentMap: Map<string, string>): Promise<Message[]> {

        // no components, i.e. empty report
        if (componentMap.size === 0) {
            this.logger.LogInfo('The SonarQube report is empty.');
            return new Promise<Message[]>(resolve => {
                resolve([]);
            });
        }

        if (!sonarQubeReport.issues) {
            this.logger.LogInfo('The SonarQube report is empty as there are no issues');
            return new Promise<Message[]>(resolve => {
                resolve([]);
            });
        }

        let issueCount: number = sonarQubeReport.issues.length;
        let newIssues = sonarQubeReport.issues.filter((issue: any) => {
            return issue.isNew === true;
        });

        this.logger.LogInfo(`The SonarQube report contains ${issueCount} issues, out of which ${newIssues.length} are new.`);
        let buildeSourceDirectory = tl.getVariable('build.sourcesDirectory');

        if (buildeSourceDirectory === null || typeof  buildeSourceDirectory === 'undefined') {
            buildeSourceDirectory = '.';
        }
        let result: Message[] = [];
        let filesCache: Map<string, string> = new Map();
        var self = this;
        for (var issue of newIssues) {
            this.logger.LogDebug(`Treating issue  : ${issue.message}`);
            let issueComponent = issue.component;

            if (!issueComponent) {
                throw new PRInjectorError(`Invalid SonarQube report - an issue does not have the component attribute. Content ${issue.content}`);
            }

            let filePath: string = componentMap.get(issueComponent);

            filePath = this.normalizeIssuePath(filePath);
            let pathForCommand: string = filePath.replace(/\//g, '\\');
            this.logger.LogDebug(`stdout pathForCommand ${pathForCommand}`);

            let command = 'where /r ' + buildeSourceDirectory + ' *.* | find' + ' "' + pathForCommand + '"';
            this.logger.LogDebug(`Running common line : ${command}`);

            if (filesCache.get(pathForCommand) == null) {
                try {
                    await exec(command)
                        .on('process', async process => {
                            this.logger.LogDebug(`process ${process.pid} ==> filePath : ${filePath} // issue message  ${issue.message}`);
                            let message = await self.fillMessagePromise(process, buildeSourceDirectory, issue, filePath);
                            filesCache.set(pathForCommand, message.file);
                            result.push(message);
                            this.logger.LogDebug(`messages.length : ${result.length}`);
                        })
                        .on('stderr', line => {
                            this.logger.LogWarning(`stderr Data : ${JSON.stringify(line)}`);
                        });
                } catch (e) {
                    this.logger.LogWarning(`Unable to execute the command line ${command}. Error ${e.message}`);
                }
            } else {
                this.logger.LogInfo(`File [${pathForCommand}] already exist, get it from cache...`);
                filePath = filesCache.get(pathForCommand);
                result.push(this.buildMessage(filePath, issue));
            }

        }
        this.logger.LogInfo(`Build Message done! : Message number ${result.length}`);

        return result;
    }

    private async fillMessagePromise(process: Process, buildeSourceDirectory: string, issue: any, filePath: string): Promise<Message> {
        let processObject: Process = process;
        let stdout: WriteableStream = processObject.stdout;
        let result = '';
        let filePathFromSourceRoot: string = '';
        stdout.on('data', chunk => {
            result += chunk.toString();
        });
        return await  new Promise<Message>(resolve => {
            // Send the buffer or you can put it into a var
            stdout.on('end', () => {
                filePathFromSourceRoot = this.escapeCommandResult(result);
                if (filePathFromSourceRoot.length > 0) {
                    filePathFromSourceRoot = filePathFromSourceRoot.substring(buildeSourceDirectory.length, filePathFromSourceRoot.length);
                    filePathFromSourceRoot = this.normalizeIssuePath(filePathFromSourceRoot);
                    filePath = filePathFromSourceRoot;
                }

                if (!filePath) {
                    throw new PRInjectorError(`Invalid SonarQube report - an issue belongs to an invalid component. Content ${issue.content}`);
                }

                let message: Message = this.buildMessage(filePath, issue);
                resolve(message);

            });
        });
    }

    private escapeCommandResult(result: string) {
        return result.replace(/(?:[\r\n]+)+/g, '');
    }

    /**
     * SQ for Maven / Gradle seem to produce inconsistent paths
     */
    private normalizeIssuePath(filePath: string) {

        if (!filePath) {
            return;
        }

        filePath = filePath.replace(/\\/g, '/');

        if (!filePath.startsWith('/')) {
            filePath = '/' + filePath;
        }

        return filePath;
    }

    // todo: filter out assembly level issues ?
    private buildMessage(path: string, issue: any): Message {
        let priority: number = this.severityService.getSeverityFromIssue(issue);
        let content: string = this.buildMessageContent(issue.message, issue.rule, priority);

        if (!issue.line) {
            this.logger.LogWarning(
                `A SonarQube issue does not have an associated line and will be ignored. File ${path}. Content ${content}`);
            return null;
        }

        let line: number = issue.line;

        if (line < 1) {
            this.logger.LogWarning(
                `A SonarQube issue was reported on line ${line} and will be ignored. File ${path}. Content ${content}`);
            return null;
        }

        let message: Message = new Message(content, path, line, priority);
        this.logger.LogDebug(`Message built : ${message}`);
        return message;
    }

    private buildMessageContent(message: string, rule: string, priority: number): string {
        let content: string = '';

        if (priority > this.severityService.getSeverityFromString('none')) {
            let severity: string = this.severityService.getSeverityDisplayName(priority);
            content = `**_${severity}_**: `;
        }
        this.logger.LogInfo(`this.sonarQubeUrl = ${this.sonarQubeUrl}`);
        let descriptionLink: string = '';
        if (this.sonarQubeUrl != null && this.sonarQubeUrl !== '') {
            descriptionLink = ` description is [here](${this.sonarQubeUrl}coding_rules#q=${rule}|languages=java))`;
        }
        content += `${message} (${rule}).${descriptionLink}`;

        return content;
    }

    /**
     * Finds and returns the first object with the given key from a given section of the SonarQube report.
     * @param sonarQubeReportSection
     * @param searchKey
     * @returns {any} Null if object not found, otherwise the first object with a "key" field matching searchKey.
     */
    private getObjectWithKey(sonarQubeReportSection: any, searchKey: string): any {

        if (!sonarQubeReportSection) {
            return null;
        }

        for (var component of sonarQubeReportSection) {
            if (!component.key) {
                throw new PRInjectorError('Invalid SonarQube report - some components do not have keys');
            }

            if (component.key === searchKey) {
                return component;
            }
        }
    }

    public getSeverityService(): ISeverityService {
        return this.severityService;
    }
}