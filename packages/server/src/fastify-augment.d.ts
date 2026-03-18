import "fastify";

declare module "fastify" {
  interface FastifyRequest {
    pathname?: string;
    preset?: string;
  }
}

export {};
