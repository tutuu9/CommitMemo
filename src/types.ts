export interface Repository {
  id: string;
  name: string;
  paths: string[];
}

export interface ProjectError {
  project: string;
  message: string;
}

export interface DiscoveryResult {
  repositories: Repository[];
  errors: ProjectError[];
}

export interface CommitRecord {
  sha: string;
  parents: string[];
  authorName: string;
  authorEmail: string;
  authoredAt: number;
  subject: string;
  body: string;
}

export interface HistoryFilter {
  startMs: number;
  endMs: number;
  allAuthors: boolean;
  authorEmails: string[];
}

export interface RepositoryHistory {
  commits: CommitRecord[];
  origin?: string;
  shallow: boolean;
  authorEmails: string[];
}

export interface Period {
  start: Date;
  end: Date;
  label: string;
  timezone: string;
}

export interface ReportCommit extends CommitRecord {
  commitUrl?: string;
  pullRequests: { number: number; url: string }[];
}

export interface ProjectReport {
  name: string;
  commits: ReportCommit[];
  shallow: boolean;
}

export interface Report {
  period: Period;
  allAuthors: boolean;
  projects: ProjectReport[];
  errors: ProjectError[];
}
