/**
 * Service to manipulate Sonar Severity
 */
export interface ISeverityService {

    getSeverityDisplayName(severity: Number): string;

    getSeverityFromIssue(issue: any): number;

    getSeverityFromString(severity: string): number;

}