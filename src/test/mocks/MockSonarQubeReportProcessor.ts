/// <reference path="../../../typings/index.d.ts" />

import {Message} from '../../module/prca/Message';
import {ISonarQubeReportProcessor} from '../../module/prca/ISonarQubeReportProcessor';
import {ISeverityService} from '../../module/prca/ISeverityService';
import {SeverityService} from '../../module/prca/SeverityService';
import {TestLogger} from './TestLogger';

/**
 * Mock SonarQubeReportProcessor for use in testing
 */
export class MockSonarQubeReportProcessor implements ISonarQubeReportProcessor {

    public getSeverityService(): ISeverityService {
        if (this.severityService == null) {
            this.severityService = new SeverityService(new TestLogger());
        }
        return this.severityService;
    }

    public messages: Message[] = null;
    private severityService: ISeverityService;

    /* Interface methods */

    public FetchCommentsFromReport(reportPath: string): Promise<Message[]> {
        return new Promise<Message[]>(resolve => {
            resolve(this.messages);
        });
    }

    /* Test methods */

    public SetCommentsToReturn(messages: Message[]): void {
        this.messages = messages;
    }

}