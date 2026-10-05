import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ApiRequest, ApiResponse } from '../server/contracts';
import { createCronHandler } from '../server/sync/cronHandler';
import { ScheduledSyncService } from '../server/sync/scheduledSyncService';
import type { PublicSyncStatus } from '../server/sync/types';

afterEach(()=>vi.unstubAllEnvs());
function fixture(count=2) {
  const order:string[]=[];
  let elapsed=0;
  let active=0;
  const runner={start:vi.fn(async(id:string)=>{
    active+=1; expect(active).toBe(1); order.push(id); await Promise.resolve(); active-=1;
    return {status:'complete',performance:{providerRequests:1}} as PublicSyncStatus;
  })};
  const store={duePlayers:vi.fn(async()=>Array.from({length:count},(_,i)=>({publicPlayerId:`player-${i}`}))),
    withScheduledLock:async<T>(work:()=>Promise<T>):Promise<T|undefined>=>work()};
  const service=new ScheduledSyncService(store,runner,()=>elapsed,()=>new Date('2026-10-05'),async(ms)=>{elapsed+=ms;});
  return {service,runner,store,order,advance:(ms:number)=>{elapsed+=ms;}};
}
describe('bounded scheduled orchestration',()=>{
  it('processes two due players serially with scheduled trigger and spacing',async()=>{
    const f=fixture();
    expect(await f.service.run('recent')).toMatchObject({processed:2,partial:false});
    expect(f.order).toEqual(['player-0','player-1']);
    expect(f.runner.start).toHaveBeenNthCalledWith(1,'player-0','incremental','scheduled');
  });
  it('no due players means no provider work',async()=>{
    const f=fixture(0); await f.service.run('recent'); expect(f.runner.start).not.toHaveBeenCalled();
  });
  it('budget wins over count and leaves remaining candidates for next invocation',async()=>{
    const f=fixture(9);
    f.runner.start.mockImplementation(async()=>{f.advance(16_000);return {status:'paused',performance:{providerRequests:1}} as PublicSyncStatus;});
    expect(await f.service.run('history')).toMatchObject({eligible:9,processed:1,partial:true});
    expect(f.runner.start).toHaveBeenCalledOnce();
  });
  it('shared lock contention prevents all work',async()=>{
    const f=fixture(); f.store.withScheduledLock=async()=>undefined;
    expect(await f.service.run('history')).toMatchObject({busy:true,partial:true,processed:0});
    expect(f.runner.start).not.toHaveBeenCalled();
  });
  it.each(['recent','history'] as const)('auth fails closed for %s before factory',async(job)=>{
    const f=fixture(0);const factory=vi.fn(()=>f.service);
    const handler=createCronHandler(job,factory);
    let status=0;let body:unknown;
    const response={setHeader:vi.fn(),status:(n:number)=>{status=n;return response;},json:(value:unknown)=>{body=value;}} as ApiResponse;
    const request={method:'GET',headers:{}} as ApiRequest;
    vi.stubEnv('CRON_SECRET',''); await handler(request,response); expect(status).toBe(503);
    vi.stubEnv('CRON_SECRET','fictional-test-secret');
    await handler(request,response);expect(status).toBe(401);
    request.headers.authorization='Bearer incorrect';await handler(request,response);expect(status).toBe(401);
    request.headers.authorization=['Bearer fictional-test-secret'];await handler(request,response);expect(status).toBe(401);
    expect(factory).not.toHaveBeenCalled();
    request.headers.authorization='Bearer fictional-test-secret';await handler(request,response);expect(status).toBe(200);
    expect(factory).toHaveBeenCalledOnce();expect(JSON.stringify(body)).not.toContain('fictional-test-secret');
  });
});
