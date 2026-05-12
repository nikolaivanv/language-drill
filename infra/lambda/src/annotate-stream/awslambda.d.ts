// Ambient declarations for the Node-runtime `awslambda` global that the
// response-streaming Lambda runtime injects (see AWS docs:
// https://docs.aws.amazon.com/lambda/latest/dg/response-streaming.html).
// The types aren't shipped in `@types/aws-lambda`; this file is the slice
// the streaming Lambda actually uses.

import type { Writable } from "node:stream";

declare global {
  const awslambda: {
    HttpResponseStream: {
      from(
        underlyingStream: Writable,
        prelude: {
          statusCode: number;
          headers?: Record<string, string>;
        },
      ): Writable;
    };
    streamifyResponse<TEvent = unknown, TContext = unknown>(
      handler: (
        event: TEvent,
        responseStream: Writable,
        context: TContext,
      ) => Promise<void>,
    ): (
      event: TEvent,
      responseStream: Writable,
      context: TContext,
    ) => Promise<void>;
  };
}

export {};
