/**
 * The task logic
 */

import path = require('path');
import glob = require('glob');

import tl = require('vsts-task-lib/task');
import {PrcaOrchestrator} from './prca/PrcaOrchestrator';
import {TaskLibLogger} from './TaskLibLogger';

tl.setResourcePath(path.join(__dirname, 'task.json'));

stopOnNonPrBuild();
let report: string = findSQReportByName();

var orchestrator: PrcaOrchestrator = PrcaOrchestrator.Create(
    new TaskLibLogger(),
    tl.getVariable('System.TeamFoundationCollectionUri'),
    getBearerToken(),
    tl.getVariable('Build.Repository.Id'),
    getPullRequestId(),
    getMessgeLimit(),
    getMinimumSeverityToDisplay(),
    getFailedTaskSeverity(),
    getCommentDisplayNamesToDelete(),
    getSonarQubeUrl());

orchestrator.postSonarQubeIssuesToPullRequest(report)
    .then(() => {
        tl.setResult(tl.TaskResult.Succeeded, tl.loc('Info_ResultSuccess')); // Set task success
    })
    .catch((error: any) => {
        tl.error(`Task failed with the following error: ${error}`);
        // Looks like: "Pull Request Code Analysis failed."
        tl.setResult(tl.TaskResult.Failed, tl.loc('Info_ResultFail')); // Set task failure
    });


function findSQReportByName(): string {

    let sonarReportDirectoryPattern = getSonarReportDirectoryPattern();
    let buildeSourceDirectory = tl.getVariable('build.sourcesDirectory');


    tl.debug(`[PRCA] findSQReportByName => buildeSourceDirectory ${buildeSourceDirectory}`);
    tl.debug(`[PRCA] findSQReportByName => sonarReportDirectoryPattern ${sonarReportDirectoryPattern}`);
    let reportGlob = path.join(buildeSourceDirectory, sonarReportDirectoryPattern, 'sonar-report.json');
    let reportGlobResults: string[] = glob.sync(reportGlob);

    tl.debug(`[PRCA] Searching for ${reportGlob} - found ${reportGlobResults.length} file(s)`);

    if (reportGlobResults.length === 0) {
        tl.setResult(tl.TaskResult.Failed, tl.loc('Error_NoReport')); // Set task failure
        process.exit(1);
    }

    if (reportGlobResults.length > 1) {
        tl.warning(tl.loc('sqAnalysis_MultipleReportTasks'));
    }

    tl.debug(`[PRCA] Using ${reportGlobResults[0]}`);
    return reportGlobResults[0];
}

function stopOnNonPrBuild() {

    tl.debug('[PRCA] Checking if this is a PR build');

    let sourceBranch: string = tl.getVariable('Build.SourceBranch');
    if (!sourceBranch.startsWith('refs/pull/')) {
        // Looks like: "Skipping pull request commenting - this build was not triggered by a pull request."
        console.log(tl.loc('Info_NotPullRequest'));
        process.exit();
    }
}

function getPullRequestId() {

    tl.debug('[PRCA] Getting the PR Id');

    let sourceBranch: string = tl.getVariable('Build.SourceBranch');
    var pullRequestId: number = Number.parseInt(sourceBranch.replace('refs/pull/', ''));

    if (isNaN(pullRequestId)) {
        tl.debug(`Expected pull request ID to be a number. Attempted to parse: ${sourceBranch.replace('refs/pull/', '')}`);
        // Looks like: "Could not retrieve pull request ID from the server."
        tl.setResult(tl.TaskResult.Failed, tl.loc('Error_InvalidPullRequestId'));
        process.exit(1);
    }

    return pullRequestId;

}

function getMessgeLimit(): number {
    let messageLimitInput: string = tl.getInput('messageLimit');
    let messageLimit: number = ~~Number(messageLimitInput); // Convert to a number and truncate (~~) any fraction
    if (isNaN(messageLimit) // if a number could not be constructed out of messageLimitInput
        || String(messageLimit) !== messageLimitInput // or if the strings are not equal when converted back (should pass for expected number values)
        || messageLimit < 1) { // or if the input was "0" or negative
        // Looks like: "Expected message limit to be a number, but instead it was NOT_A_NUMBER"
        tl.setResult(tl.TaskResult.Failed, tl.loc('Error_InvalidMessageLimit', messageLimitInput));
        process.exit(1);
    }

    tl.debug('[PRCA] The message limit is: ' + messageLimit);
    return messageLimit;
}

function getMinimumSeverityToDisplay(): string {
    let minimumSeverityToDisplay: string = tl.getInput('minimumSeverityToDisplay');
    if (typeof  minimumSeverityToDisplay === undefined
        || minimumSeverityToDisplay === null
        || minimumSeverityToDisplay === '') {
        tl.setResult(tl.TaskResult.Failed, tl.loc('Error_InvalidMinimumSeverityToDisplay', minimumSeverityToDisplay));
        process.exit(1);
    }

    tl.debug('[PRCA] The minimum issues severity to display is: ' + minimumSeverityToDisplay);
    return minimumSeverityToDisplay;
}

function getFailedTaskSeverity(): string {
    let failedSeverity: string = tl.getInput('failedTaskSeverity');
    if (typeof  failedSeverity === undefined
        || failedSeverity === null
        || failedSeverity === '') {
        tl.setResult(tl.TaskResult.Failed, tl.loc('Error_InvalidFailedTaskSeverity', failedSeverity));
        process.exit(1);
    }

    tl.debug('[PRCA] The failed task severity is: ' + failedSeverity);
    return failedSeverity;
}

function getSonarReportDirectoryPattern(): string {
    let sonarReportDirectoryPattern: string = tl.getInput('sonarReportDirectoryPattern');
    if (typeof  sonarReportDirectoryPattern === undefined
        || sonarReportDirectoryPattern === null) {
        tl.setResult(tl.TaskResult.Failed, tl.loc('Error_InvalidSonarReportDirectoryPattern', sonarReportDirectoryPattern));
        process.exit(1);
    }

    tl.debug('[PRCA] The sonar Report directory is: ' + sonarReportDirectoryPattern);
    return sonarReportDirectoryPattern;
}

function getCommentDisplayNamesToDelete(): string[] {
    let parameter: string = tl.getInput('commentDisplayNamesToDelete');
    if (typeof  parameter === undefined
        || parameter === null) {
        tl.setResult(tl.TaskResult.Failed, tl.loc('Error_InvalidCommentDisplayNamesToDelete', parameter));
        process.exit(1);
    }
    let displayNames = parameter.split(',');
    tl.debug('[PRCA] The failed task severity is: ' + parameter);
    return displayNames;
}

function getSonarQubeUrl(): string {
    // Check to ensure getEndpointUrl exists on the current agent
    if (tl.getEndpointUrl == null) {
        tl.warning('Could not decode the generic endpoint. Please ensure you are running the latest agent (min version 0.3.2)');
    }
    let genericEndpointName: string = tl.getInput('sqConnectedServiceName');
    let hostUrl: string = tl.getEndpointUrl(genericEndpointName, false);
    tl.debug(`[PRCA] SonarQube endpoint: ${hostUrl}`);
    if (hostUrl != null && hostUrl !== '' && !hostUrl.endsWith('/')) {
        hostUrl = hostUrl + '/';
    }
    tl.debug(`[PRCA] SonarQube endpoint: ${hostUrl}`);
    return hostUrl;
}

function getBearerToken() {

    tl.debug('[PRCA] Getting the agent bearer token');

    // Get authentication from the agent itself
    var auth = tl.getEndpointAuthorization('SYSTEMVSSCONNECTION', false);
    if (auth.scheme !== 'OAuth') {
        // Looks like: "Could not get an authentication token from the build agent."
        tl.error(tl.loc('Error_FailedToGetAuthToken'));
        // Looks like: "Pull Request Code Analysis failed."
        tl.setResult(tl.TaskResult.Failed, tl.loc('Info_ResultFail')); // Set task failure
        process.exit(1);
    }

    return auth.parameters['AccessToken'];
}