import {ISeverityService} from './ISeverityService';
import {ILogger} from './ILogger';


enum Severity {
    none = 1,
    info,
    minor,
    major,
    critical,
    blocker
}

/**
 * Default Severity Service
 */
export class SeverityService implements ISeverityService {
    private logger: ILogger;

    constructor(logger: ILogger) {
        if (!logger) {
            throw new ReferenceError('logger');
        }

        this.logger = logger;
    }

    public getSeverityDisplayName(priority: Number): string {
        switch (priority) {
            case Severity.blocker:
                return Severity[Severity.blocker];
            case Severity.critical:
                return Severity[Severity.critical];
            case Severity.major:
                return Severity[Severity.major];
            case Severity.minor:
                return Severity[Severity.minor];
            case Severity.info:
                return Severity[Severity.info];
            default:
                return Severity[Severity.none];
        }
    }

    public getSeverityFromIssue(issue: any): number {
        let severity: string = issue.severity;
        if (!severity) {
            this.logger.LogWarning(`Issue ${issue.content} does not have a priority associated`);
            severity = 'none';
        }
        return this.getSeverityFromString(severity);
    }

    public getSeverityFromString(severity: string): number {
        if (!severity) {
            this.logger.LogWarning(`Severity provided is not correct [${severity}]`);
            severity = 'none';
        }

        switch (severity.toLowerCase()) {
            case 'blocker':
                return Severity.blocker;
            case 'critical':
                return Severity.critical;
            case 'major':
                return Severity.major;
            case 'minor':
                return Severity.minor;
            case 'info':
                return Severity.info;
            default:
                return Severity.none;
        }
    }


}