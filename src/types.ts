export interface IgChangeValue {
  id?: string;
  comment_id?: string;
  media_id?: string;
  [key: string]: unknown;
}

export interface IgChange {
  field: string;
  value: IgChangeValue;
}

export interface IgEntry {
  id: string;
  time: number;
  changes: IgChange[];
}

export interface IgWebhookBody {
  object: string;
  entry: IgEntry[];
}

export interface CommentJob {
  commentId: string;
  mediaId: string;
  eventTime: number;
}
