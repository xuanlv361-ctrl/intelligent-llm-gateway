import {beforeEach,describe,expect,it,vi} from 'vitest';
import {ApiError,apiRequest,initializeEnterpriseSession,resetEnterpriseSecurityClientForTests} from './lib/apiClient';

function response(body:unknown,status=200,headers:Record<string,string>={}){
  return new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json',...headers}});
}

describe('enterprise API client security',()=>{
  beforeEach(()=>{resetEnterpriseSecurityClientForTests();vi.restoreAllMocks();});

  it('reuses one bootstrap and sends the session-bound CSRF header',async()=>{
    const fetchMock=vi.spyOn(globalThis,'fetch')
      .mockResolvedValueOnce(response({detail:{code:'authentication_required'}},401))
      .mockResolvedValueOnce(response({csrf_token:'csrf-one'}))
      .mockResolvedValueOnce(response({ok:true},200,{'X-CSRF-Token':'csrf-two'}))
      .mockResolvedValueOnce(response({ok:true},200,{'X-CSRF-Token':'csrf-three'}));
    await Promise.all([initializeEnterpriseSession(),initializeEnterpriseSession()]);
    await apiRequest('/api/v1/circuit-breakers/a',{method:'POST',body:'{}'});
    await apiRequest('/api/v1/circuit-breakers/b',{method:'POST',body:'{}'});
    expect(fetchMock).toHaveBeenCalledTimes(4);
    const firstWrite=new Headers((fetchMock.mock.calls[2][1] as RequestInit).headers);
    const secondWrite=new Headers((fetchMock.mock.calls[3][1] as RequestInit).headers);
    expect(firstWrite.get('X-CSRF-Token')).toBe('csrf-one');
    expect(secondWrite.get('X-CSRF-Token')).toBe('csrf-two');
    for(const call of fetchMock.mock.calls)expect((call[1] as RequestInit).credentials).toBe('include');
  });

  it('does not attach client-supplied principal, role, permission or tenant headers',async()=>{
    const fetchMock=vi.spyOn(globalThis,'fetch')
      .mockResolvedValueOnce(response({csrf_token:'csrf-safe'}))
      .mockResolvedValueOnce(response({ok:true}));
    await apiRequest('/api/v1/evidence');
    const headers=new Headers((fetchMock.mock.calls[1][1] as RequestInit).headers);
    expect(headers.has('X-Principal-ID')).toBe(false);
    expect(headers.has('X-Roles')).toBe(false);
    expect(headers.has('X-Permissions')).toBe(false);
    expect(headers.has('X-Tenant-ID')).toBe(false);
    expect(headers.has('X-Workspace-ID')).toBe(false);
  });

  it.each([
    [401,'AUTH_EXPIRED','authentication_required'],
    [403,'csrf_invalid','csrf_failed'],
    [403,'origin_rejected','origin_rejected'],
    [403,'rbac_denied','permission_denied'],
    [404,'not_found','api_route_not_found'],
    [502,'bad_gateway','proxy_error'],
    [503,'database_not_ready','database_not_ready'],
    [503,'starting','backend_starting'],
  ])('classifies HTTP %s/%s without reporting a connection failure',async(status,code,expected)=>{
    vi.spyOn(globalThis,'fetch')
      .mockResolvedValueOnce(response({csrf_token:'csrf-safe'}))
      .mockResolvedValueOnce(response({detail:{code}},status));
    await expect(apiRequest('/api/v1/example')).rejects.toMatchObject({detail:{code:expected,status}});
  });

  it('classifies a fetch rejection as backend_offline with a safe diagnostic id',async()=>{
    vi.spyOn(globalThis,'fetch').mockRejectedValueOnce(new TypeError('Failed to fetch secret=do-not-copy'));
    try{await apiRequest('/api/v1/example');throw new Error('expected rejection');}
    catch(error){
      expect(error).toBeInstanceOf(ApiError);
      const detail=(error as ApiError).detail;
      expect(detail.code).toBe('backend_offline');
      expect(detail.retryable).toBe(true);
      expect(detail.diagnosticId).toMatch(/^local-/);
      expect(JSON.stringify(detail)).not.toContain('do-not-copy');
    }
  });

  it('classifies an aborted request as request_timeout',async()=>{
    vi.spyOn(globalThis,'fetch').mockRejectedValueOnce(new DOMException('aborted','AbortError'));
    await expect(apiRequest('/api/v1/example')).rejects.toMatchObject({detail:{code:'request_timeout',retryable:true}});
  });
});
