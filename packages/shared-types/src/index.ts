/**
 * Shared types for Rezo.
 *
 * The standard API response envelope (spec §15):
 *   success -> { data: <T>, error: null }
 *   failure -> { data: null, error: { code, message } }
 *
 * Every Rezo API endpoint returns one of these shapes.
 */

export interface ApiError {
  code: string;
  message: string;
}

export interface ApiSuccess<T> {
  data: T;
  error: null;
}

export interface ApiFailure {
  data: null;
  error: ApiError;
}

export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

/** Payload of GET /api/v1/health */
export interface HealthStatus {
  status: 'ok';
}
