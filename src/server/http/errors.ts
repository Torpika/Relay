import { ZodError } from "zod";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function errorResponse(error: unknown): Response {
  if (error instanceof ApiError) {
    return Response.json(
      {
        error: {
          code: error.code,
          message: error.message,
          ...(error.details === undefined ? {} : { details: error.details })
        }
      },
      { status: error.status }
    );
  }

  if (error instanceof ZodError) {
    return Response.json(
      {
        error: {
          code: "invalid_request",
          message: "The request did not pass validation",
          details: error.issues
        }
      },
      { status: 400 }
    );
  }

  console.error(error);

  return Response.json(
    {
      error: {
        code: "internal_error",
        message: "An unexpected error occurred"
      }
    },
    { status: 500 }
  );
}

export function apiRoute<TArguments extends unknown[]>(
  handler: (...arguments_: TArguments) => Promise<Response>
): (...arguments_: TArguments) => Promise<Response> {
  return async (...arguments_: TArguments) => {
    try {
      return await handler(...arguments_);
    } catch (error) {
      return errorResponse(error);
    }
  };
}
