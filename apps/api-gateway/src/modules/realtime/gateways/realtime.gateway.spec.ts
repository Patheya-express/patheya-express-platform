import { RealtimeGateway } from './realtime.gateway';

describe('RealtimeGateway.disconnectUser', () => {
  it("disconnects every socket in the target user's room", () => {
    const disconnectSockets = jest.fn().mockResolvedValue(undefined);
    const server = { in: jest.fn().mockReturnValue({ disconnectSockets }) };

    const gateway = new RealtimeGateway({} as any, {} as any);
    (gateway as unknown as { server: typeof server }).server = server;

    gateway.disconnectUser('user-1');

    expect(server.in).toHaveBeenCalledWith('user:user-1');
    expect(disconnectSockets).toHaveBeenCalledWith(true);
  });
});
