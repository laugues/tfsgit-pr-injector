/// <reference path="../../typings/index.d.ts" />

/**
 * Tests for interactions with the server.
 */

import {Message} from '../module/prca/Message';
import {SonarQubeReportProcessor} from '../module/prca/SonarQubeReportProcessor';
import {PrcaOrchestrator} from '../module/prca/PrcaOrchestrator';

import {TestLogger} from './mocks/TestLogger';
import {MockPrcaService} from './mocks/MockPrcaService';
import {MockSonarQubeReportProcessor} from './mocks/MockSonarQubeReportProcessor';

import * as chai from 'chai';
import {expect} from 'chai';
import * as path from 'path';
import {SeverityService} from '../module/prca/SeverityService';
import {ISeverityService} from '../module/prca/ISeverityService';

describe('The PRCA Orchestrator', () => {

    let fakeMessage: Message = new Message('foo bar', './foo/bar.txt', 1, 1);
    let testLogger: TestLogger;
    before(() => {
        testLogger = new TestLogger();
        chai.should();
    });

    context('fails when it', () => {
        let testLogger: TestLogger;
        let server: MockPrcaService;
        let sqReportProcessor: SonarQubeReportProcessor;
        let orchestrator: PrcaOrchestrator; // object under test

        beforeEach(() => {
            testLogger = new TestLogger();
            server = new MockPrcaService();
            let severityService: ISeverityService = new SeverityService(testLogger);
            sqReportProcessor = new SonarQubeReportProcessor(testLogger, severityService, '');
            orchestrator = new PrcaOrchestrator(testLogger, sqReportProcessor, server, '');
        });

        it('fails retrieving the list of files in the pull request', () => {

            // Arrange
            var expectedMessages: Message[] = [fakeMessage, fakeMessage];
            server.createCodeAnalysisThreads(expectedMessages); // post some messages to test that the orchestrator doesn't delete them
            server.getModifiedFilesInPr_shouldFail = true;
            var sqReportPath: string = path.join(__dirname, 'data', 'sonar-report.json');

            // Act
            return orchestrator.postSonarQubeIssuesToPullRequest(sqReportPath)
                .then(() => {
                    return Promise.reject('Should not have finished successfully');
                }, (error) => {
                    // We expect to fail
                    expect(server.getSavedMessages().length).to.eql(0, 'The server messages should have been deleted');
                    return Promise.resolve(true);
                });
        });
        it('fails deleting old PRCA comments but we don\'t raise a reject promise', () => {
            // Arrange
            var expectedMessages: Message[] = [fakeMessage, fakeMessage];
            server.createCodeAnalysisThreads(expectedMessages); // post some messages to test that the orchestrator doesn't delete them
            server.deleteCodeAnalysisComments_shouldFail = true;
            var sqReportPath: string = path.join(__dirname, 'data', 'sonar-report.json');

            // Act
            return orchestrator.postSonarQubeIssuesToPullRequest(sqReportPath)
                .then(() => {
                    expect(server.getSavedMessages()).to.eql(expectedMessages, 'Expected existing PRCA messages to still be on the server');
                    return Promise.resolve(true);
                }, (error) => {
                    // We expect to fail
                    return Promise.reject(`We should not raise a reject error like ${error}`);
                });
        });

        it('fails posting new PRCA comments', () => {
            // Arrange
            var oldMessages: Message[] = [fakeMessage, fakeMessage];
            server.createCodeAnalysisThreads(oldMessages); // post some messages to test that the orchestrator deletes them
            server.createCodeAnalysisThreads_shouldFail = true;
            var sqReportPath: string = path.join(__dirname, 'data', 'sonar-report.json');

            // Act
            return orchestrator.postSonarQubeIssuesToPullRequest(sqReportPath)
                .then(() => {
                    return Promise.reject('Should not have finished successfully');
                }, (error) => {
                    // We expect to fail
                    expect(server.getSavedMessages()).to.have.length(0, 'Expected old PRCA comments to have been deleted');
                    return Promise.resolve(true);
                });
        });
    });

    context('succeeds when it', () => {
        let testLogger: TestLogger;
        let server: MockPrcaService;
        let sqReportProcessor: SonarQubeReportProcessor;
        let orchestrator: PrcaOrchestrator; // object under test

        beforeEach(() => {
            testLogger = new TestLogger();
            server = new MockPrcaService();
            let severityService: ISeverityService = new SeverityService(testLogger);
            sqReportProcessor = new SonarQubeReportProcessor(testLogger, severityService, '');
            orchestrator = new PrcaOrchestrator(testLogger, sqReportProcessor, server, '');
        });

        it('has no comments to post (no issues reported)', () => {
            // Arrange
            // no changed files => new files to post issues on
            var oldMessages: Message[] = [fakeMessage, fakeMessage];
            server.createCodeAnalysisThreads(oldMessages); // post some messages to test that the orchestrator deletes them
            server.setModifiedFilesInPr([]);
            var sqReportPath: string = path.join(__dirname, 'data', 'sonar-no-issues.json');

            // Act
            return orchestrator.postSonarQubeIssuesToPullRequest(sqReportPath)
                .then(() => {
                    // Assert
                    expect(server.getSavedMessages()).to.have.length(0, 'Correct number of comments');
                });
        });

        it('has no comments to post (no issues in changed files)', () => {
            // Arrange
            var oldMessages: Message[] = [fakeMessage, fakeMessage];
            server.createCodeAnalysisThreads(oldMessages); // post some messages to test that the orchestrator deletes them
            server.setModifiedFilesInPr([]);
            var sqReportPath: string = path.join(__dirname, 'data', 'sonar-no-new-issues.json');

            // Act
            return orchestrator.postSonarQubeIssuesToPullRequest(sqReportPath)
                .then(() => {
                    // Assert
                    expect(server.getSavedMessages()).to.have.length(0, 'Correct number of comments');
                });
        });

        it('has 1 comment to post', () => {
            // Arrange
            var oldMessages: Message[] = [fakeMessage, fakeMessage];
            server.createCodeAnalysisThreads(oldMessages); // post some messages to test that the orchestrator deletes them
            server.setModifiedFilesInPr(['/src/test/java/com/mycompany/app/AppTest.java']);
            var sqReportPath: string = path.join(__dirname, 'data', 'sonar-report.json');

            // Act
            return orchestrator.postSonarQubeIssuesToPullRequest(sqReportPath)
                .then(() => {
                    // Assert
                    expect(server.getSavedMessages()).to.have.length(1, 'Correct number of comments');
                });
        });

        it('has multiple comments to post', () => {
            // Arrange
            server.setModifiedFilesInPr(['prefix/my-app/src/main/java/com/mycompany/app/App.java']);
            var sqReportPath: string = path.join(__dirname, 'data', 'sonar-report.json');

            // Act
            return orchestrator.postSonarQubeIssuesToPullRequest(sqReportPath)
                .then(() => {
                    // Assert
                    expect(server.getSavedMessages()).to.have.length(1, 'Correct number of comments');
                });
        });

        it('has more comments to post than the limit allows', () => {
            // Arrange
            server.setModifiedFilesInPr(['src/main/java/com/mycompany/app/App.java']);
            var sqReportPath: string = path.join(__dirname, 'data', 'sonar-no-issues.json');
            let mockSqReportProcessor: MockSonarQubeReportProcessor = new MockSonarQubeReportProcessor();
            let orchestrator: PrcaOrchestrator =
                new PrcaOrchestrator(testLogger, mockSqReportProcessor, server, '');

            let messages: Message[] = [];
            // Set (getMessageLimit() + 50) messages to return
            for (var i = 0; i < orchestrator.getMessageLimit() + 50; i = i + 1) {
                let message: Message;
                // Some of the messages will have a higher severity, so that we can check that they have all been posted
                if (i < orchestrator.getMessageLimit() + 30) {
                    message = new Message('foo', 'src/main/java/com/mycompany/app/App.java', 1, 3);
                } else {
                    message = new Message('bar', 'src/main/java/com/mycompany/app/App.java', 1, 2);
                }
                messages.push(message);
            }
            mockSqReportProcessor.SetCommentsToReturn(messages);

            // Act
            return orchestrator.postSonarQubeIssuesToPullRequest(sqReportPath)
                .then(() => {
                    // Assert
                    expect(server.getSavedMessages()).to.have.length(orchestrator.getMessageLimit(), 'Correct number of comments');

                    var priorityOneThreads = server.getSavedMessages().filter(
                        (message: Message) => {
                            return message.content === 'bar';
                        }
                    );
                    expect(priorityOneThreads).to.have.length(20, 'High severity comments were all posted');
                });
        });

        it('has more high-severity comments to post than the limit allows', () => {
            // Arrange
            server.setModifiedFilesInPr(['src/main/java/com/mycompany/app/App.java']);
            var sqReportPath: string = path.join(__dirname, 'data', 'sonar-no-issues.json');
            let mockSqReportProcessor: MockSonarQubeReportProcessor = new MockSonarQubeReportProcessor();
            let orchestrator: PrcaOrchestrator =
                new PrcaOrchestrator(testLogger, mockSqReportProcessor, server, '');

            let messages: Message[] = [];
            // Set (getMessageLimit() + 50) messages to return
            for (var i = 0; i < orchestrator.getMessageLimit() + 50; i += 1) {
                let message: Message;
                // (getMessageLimit() + 20 of the messages are high severity, so we expect all posted messages to be at the highest severity
                if (i < 30) {
                    message = new Message('foo', 'src/main/java/com/mycompany/app/App.java', 1, 3);
                } else {
                    message = new Message('bar', 'src/main/java/com/mycompany/app/App.java', 1, 2);
                }
                messages.push(message);
            }
            mockSqReportProcessor.SetCommentsToReturn(messages);

            // Act

            return orchestrator.postSonarQubeIssuesToPullRequest(sqReportPath)
                .then(() => {
                    // Assert
                    expect(server.getSavedMessages()).to.have.length(orchestrator.getMessageLimit(), 'Correct number of comments');

                    var priorityOneThreads = server.getSavedMessages().filter(
                        (message: Message) => {
                            return message.content === 'bar';
                        }
                    );
                    expect(priorityOneThreads).to.have.length(orchestrator.getMessageLimit(), 'All posted comments were high severity');
                });
        });

        it('is given a different comment limit', () => {
            // Arrange
            server.setModifiedFilesInPr(['src/main/java/com/mycompany/app/App.java']);
            var sqReportPath: string = path.join(__dirname, 'data', 'sonar-no-issues.json');

            let mockSqReportProcessor: MockSonarQubeReportProcessor = new MockSonarQubeReportProcessor();
            let messages: Message[] = [];
            // Set 10 messages to return
            for (var i = 0; i < 10; i += 1) {
                messages.push(new Message('bar', 'src/main/java/com/mycompany/app/App.java', 1, 2));
            }
            mockSqReportProcessor.SetCommentsToReturn(messages);

            // Act
            let orchestrator: PrcaOrchestrator =
                new PrcaOrchestrator(testLogger, mockSqReportProcessor, server, '', 5); // set a message limit of 5

            return orchestrator.postSonarQubeIssuesToPullRequest(sqReportPath)
                .then(() => {
                    // Assert
                    expect(server.getSavedMessages()).to.have.length(orchestrator.getMessageLimit(), 'Correct number of comments');

                    var correctThreads = server.getSavedMessages().filter(
                        (message: Message) => {
                            return message.content === 'bar';
                        }
                    );
                    expect(correctThreads).to.have.length(orchestrator.getMessageLimit(), 'All posted comments had correct content');
                });
        });
    });
});