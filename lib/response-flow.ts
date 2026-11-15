import type { ServerResponse } from 'node:http';

/** Wait until a response can accept another chunk, or report that its peer went away. */
export function waitForDrainOrClose(res: Pick<ServerResponse, 'once' | 'off' | 'destroyed' | 'writableEnded'>): Promise<boolean> {
  if (res.destroyed || res.writableEnded) return Promise.resolve(false);
  return new Promise((resolve) => {
    const finish = (canContinue: boolean) => {
      res.off('drain', onDrain);
      res.off('close', onClose);
      resolve(canContinue);
    };
    const onDrain = () => finish(true);
    const onClose = () => finish(false);
    res.once('drain', onDrain);
    res.once('close', onClose);
  });
}
