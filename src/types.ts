export interface PostMessageRequest {
  channel_id: string;
  user_id: string;
  content: string;
  consistency?: string;
  client_msg_id?: string;
}

export interface PostMessageResponse {
  ok: true;
  message_id?: string;
  deduped?: boolean;
}

export interface GetMessagesQuery {
  limit?: string;
  before?: string;
  after?: string;
  consistency?: string;
}

export interface Message {
  channel_id: string;
  message_id: string;
  user_id: string;
  content: string;
  created_at: string;
}

export interface GetMessagesResponse {
  ok: true;
  items: Message[];
  page: {
    next_before: string | null;
  };
}

export interface ErrorResponse {
  ok: false;
  error: {
    code: string;
    message: string;
    details?: any;
  };
}

export interface HealthResponse {
  ok: true;
  dc: string;
  keyspace: string;
}

export type ApiResponse<T = any> = T | ErrorResponse;