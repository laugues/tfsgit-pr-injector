import tl = require('vsts-task-lib/task');
import * as web from 'vso-node-api/WebApi';
import {WebApi} from 'vso-node-api/WebApi';

import {ILogger} from './ILogger';
import {Message} from './Message';
import {ISonarQubeReportProcessor} from './ISonarQubeReportProcessor';
import {SonarQubeReportProcessor} from './SonarQubeReportProcessor';
import {IPrcaService} from './IPrcaService';
import {PrcaService} from './PrcaService';
import {ISeverityService} from './ISeverityService';
import {SeverityService} from './SeverityService';

/**
 * PRCA (Pull Request Code Analysis) Orchestrator
 * Orchestrates the processing of SonarQube reports and posting issues to pull requests as comments
 *
 * @export
 * @class CodeAnalysisOrchestrator
 */
export class PrcaOrchestrator {

    private sqReportProcessor: ISonarQubeReportProcessor;
    private prcaService: IPrcaService;
    private logger: ILogger;
    private messageLimit: number = 100;
    private _minimumSeverityToDisplay: string = 'info';
    private _failedTaskSeverity: string = 'none';
    private _commentDisplayNamesToDelete: string[] = [];
    private _sonarQubeUrl: string = '';


    /**
     * This constructor gives full control of the ISonarQubeReportProcessor and IPrcaService.
     * If such control isn't required, see the static method PrcaOrchestrator.CreateOrchestrator() below.
     *
     * @param logger Platform-independent logging
     * @param sqReportProcessor Parses report files into Message objects
     * @param prcaService Handles interaction with the serverside
     * @param sonarQubeUrl url of sonar qube
     * @param messageLimit (Optional) A limit to the number of messages posted for performance and experience reasons.
     * @param minimumSeverityToDisplay (Optional) The minimum comments severity to display
     * @param failedTaskSeverity (Optional) the severity that will failed the task if at least one comment exists
     * with this severity
     * @param commentDisplayNamesToDelete (Optional) display names used for comment deletion
     */
    constructor(logger: ILogger, sqReportProcessor: ISonarQubeReportProcessor, prcaService: IPrcaService, sonarQubeUrl: string, messageLimit?: number,
                minimumSeverityToDisplay?: string, failedTaskSeverity?: string, commentDisplayNamesToDelete?: string[]) {
        if (!logger) {
            throw new ReferenceError('logger');
        }
        if (!sqReportProcessor) {
            throw new ReferenceError('sqReportProcessor');
        }
        if (!prcaService) {
            throw new ReferenceError('PrcaService');
        }

        this.logger = logger;
        this.sqReportProcessor = sqReportProcessor;
        this.prcaService = prcaService;

        if (messageLimit != null && messageLimit !== undefined) {
            this.messageLimit = messageLimit;
        }

        if (sonarQubeUrl != null && sonarQubeUrl !== undefined) {
            this._sonarQubeUrl = sonarQubeUrl;
        }

        if (minimumSeverityToDisplay != null && minimumSeverityToDisplay !== undefined) {
            this._minimumSeverityToDisplay = minimumSeverityToDisplay;
        }
        if (failedTaskSeverity != null && failedTaskSeverity !== undefined) {
            this._failedTaskSeverity = failedTaskSeverity;
        }
        if (commentDisplayNamesToDelete != null && commentDisplayNamesToDelete !== undefined) {
            this._commentDisplayNamesToDelete = commentDisplayNamesToDelete;
        }
    }

    /**
     * This static constructor is intended for general-use creation of PrcaOrchestrator instances.
     * @param logger Platform-independent logging
     * @param collectionUrl The URL of the server
     * @param token Authentication token
     * @param repositoryId Internal ID of the repository
     * @param pullRequestId Internal ID of the pull request
     * @returns {PrcaOrchestrator}
     */
    public static Create(logger: ILogger,
                         collectionUrl: string,
                         bearerToken: string,
                         repositoryId: string,
                         pullRequestId: number,
                         messageLimit: number,
                         minimumSeverityToDisplay: string,
                         failedTaskSeverity: string,
                         commentDisplayNamesToDelete: string[],
                         sonarQubeUrl: string): PrcaOrchestrator {

        if (collectionUrl == null) {
            throw new ReferenceError('collectionUrl');
        }
        if (bearerToken == null) {
            throw new ReferenceError('token');
        }

        let creds = web.getBearerHandler(bearerToken);
        var connection = new WebApi(collectionUrl, creds);

        let prcaService: IPrcaService = new PrcaService(logger, connection.getGitApi(), repositoryId, pullRequestId);
        let severityService: ISeverityService = new SeverityService(logger);
        let reportProcessor: ISonarQubeReportProcessor = new SonarQubeReportProcessor(logger, severityService, sonarQubeUrl);
        return new PrcaOrchestrator(logger, reportProcessor, prcaService, sonarQubeUrl, messageLimit, minimumSeverityToDisplay,
            failedTaskSeverity, commentDisplayNamesToDelete);
    }

    /**
     * An upper limit on the number of messages that will be posted to the pull request.
     * The first n messages by severity will be posted.
     *
     * @returns {number}
     */
    public getMessageLimit(): number {
        return this.messageLimit;
    }

    /**
     * Fetches messages from the SonarQube report, filters and sorts them, then posts them to the pull request.
     *
     * @param sqReportPath
     * @returns {Promise<void>}
     */
    public async postSonarQubeIssuesToPullRequest(sqReportPath: string): Promise<void> {
        if (sqReportPath === undefined || sqReportPath === null) {
            // Looks like: "Make sure a Maven or Gradle ran before this step and SonarQube was enabled."
            return Promise.reject(tl.loc('Error_NoReportPathFound'));
        }
        this.logger.LogInfo(`[PRCA] SonarQube report path: ${sqReportPath}`);
        var allMessages: Message[] = await this.sqReportProcessor.FetchCommentsFromReport(sqReportPath);
        var messagesToPost: Message[] = null;
        return Promise.resolve()
            .then(() => {
                // Delete previous messages
                return this.prcaService.deleteCodeAnalysisComments(this._commentDisplayNamesToDelete)
                    .catch((error) => {
                        this.logger.LogWarning(`[PRCA] Failed to delete previous PRCA comments. Reason: ${error}`);
                        // Looks like: "Failed to delete previous PRCA comments."
                        return Promise.resolve();
                    });
            })
            .then(() => {
                return this.prcaService.getModifiedFilesInPr()
                    .catch((error) => {
                        this.logger.LogDebug(`[PRCA] Failed to get the files modified by the pull request. Reason: ${error}`);
                        // Looks like: "Failed to get the files modified by the pull request."
                        return Promise.reject(tl.loc('Info_ResultFail_FailedToGetModifiedFiles'));
                    });
            })
            .then((filesChanged: string[]) => {
                this.logger.LogDebug(`[PRCA] ${filesChanged.length} changed files in the PR: ${filesChanged}`);
                this.logger.LogDebug(`[PRCA] ${allMessages.length} messages exist before filtering`);
                this.logger.LogDebug(`[PRCA] All messages content : ${allMessages}`);
                messagesToPost = this.filterMessages(filesChanged, allMessages);
                this.logger.LogInfo(`[PRCA] ${messagesToPost.length} messages exist after filtering`);

            })
            .then(() => {
                // Create new messages
                this.logger.LogInfo(`[PRCA] ${messagesToPost.length} messages are to be posted.`);
                return this.prcaService.createCodeAnalysisThreads(messagesToPost)
                    .catch((error) => {
                        this.logger.LogDebug(`[PRCA] Failed to post new PRCA comments. Reason: ${error}`);
                        // Looks like: "Failed to post new PRCA comments."
                        return Promise.reject(tl.loc('Info_ResultFail_FailedToPostNewComments'));
                    });
            }).then(() => {
                if (this.isMessageWithFailedSeverity(messagesToPost)) {
                    return Promise.reject(tl.loc('Info_ResultFail_IssuesWithFailedSevertity', this._failedTaskSeverity));
                } else {
                    return Promise.resolve();
                }
            });
    }

    /* Helper methods */

    private filterMessages(filesChangedInPr: string[], allMessages: Message[]): Message[] {
        let result: Message[];
        this.logger.LogDebug(`[PRCA] filterMessages() ${filesChangedInPr}`);

        // Filter by message relating to files that were changed in this PR only
        let severityService = this.sqReportProcessor.getSeverityService();
        let minimumSeverity = severityService.getSeverityFromString(this._minimumSeverityToDisplay);

        result = allMessages.filter(
            (message: Message) => {

                if (message != null) {
                    // If message.file is in filesChanged

                    for (let fileChangedInPr of filesChangedInPr) {
                        if (message.severity >= minimumSeverity) {

                            // case-insensitive normalising file path comparison
                            if (fileChangedInPr.toLowerCase().endsWith(message.file.toLowerCase())) {
                                this.logger.LogDebug('[PRCA] PR change file [' + fileChangedInPr.toLowerCase() + '] correspond to' +
                                    ' message file [' + message.file.toLowerCase() + ']  ? [' + fileChangedInPr.toLowerCase().endsWith(message.file.toLowerCase()) + ']');
                                return true;
                            }
                        }
                    }

                }
                return false;
            });
        this.logger.LogInfo(`[PRCA] ${result.length} messages are for files changed in this PR. ${allMessages.length - result.length} messages are not.`);

        // Sort messages (Message.compare implements sorting by descending severity)
        result = result.sort(Message.compare);

        // Truncate to the first 100 to reduce perf and experience impact of being flooded with messages
        if (result.length > this.messageLimit) {
            this.logger.LogInfo(`[PRCA] The number of messages posted is limited to ${this.messageLimit}. ${result.length - this.messageLimit} messages will not be posted.`);
        }
        result = result.slice(0, this.messageLimit);

        return result;
    }

    private isMessageWithFailedSeverity(messages: Message[]): boolean {
        let severityService = this.sqReportProcessor.getSeverityService();
        let faileTaskSeverity = severityService.getSeverityFromString(this._failedTaskSeverity);
        let noneSeverity = severityService.getSeverityFromString('none');
        let messagesWithFailedTaskSeveirty = messages.filter(
            (message: Message) => {
                if (message != null) {
                    if (message.severity >= faileTaskSeverity && faileTaskSeverity !== noneSeverity) {
                        this.logger.LogWarning(`The message message ${message.content} has a severity [${this._failedTaskSeverity}] or higher.`);
                        return true;
                    }
                }
                return false;
            });

        return messagesWithFailedTaskSeveirty.length > 0;
    }


    get minimumSeverityToDisplay(): string {
        return this._minimumSeverityToDisplay;
    }

    set minimumSeverityToDisplay(value: string) {
        this._minimumSeverityToDisplay = value;
    }

}