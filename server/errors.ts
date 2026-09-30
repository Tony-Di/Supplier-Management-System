/** A request that breaks a business rule. The error handler reports it as 400 with this message. */
export class ValidationError extends Error {
  status = 400;
}
