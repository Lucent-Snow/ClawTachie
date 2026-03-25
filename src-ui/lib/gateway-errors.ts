export function stringifyGatewayError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function shouldReconnectGateway(error: unknown): boolean {
  const message = stringifyGatewayError(error);
  return /gateway not connected|gateway loop is not available|gateway response channel closed|gateway loop stopped/i.test(
    message,
  );
}
