/* Windows SQLite broker SCM host. State-changing operations remain disabled
 * until the durable manifest and NTFS handle-relative backend are linked. */
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <sddl.h>
#include <stdint.h>
#include <stdio.h>
#include <wchar.h>
#include <strsafe.h>
#define PIPE_NAME L"\\\\.\\pipe\\LogicEngine.SqliteBroker.v1"
#define MAGIC 0x4c454256u
#define VERSION 2u
#define MAX_PACKET 4096u
static uint16_t net16(uint16_t v){return (uint16_t)((v<<8)|(v>>8));}
static uint32_t net32(uint32_t v){return ((v&0x000000ffu)<<24)|((v&0x0000ff00u)<<8)|((v&0x00ff0000u)>>8)|((v&0xff000000u)>>24);}
static uint64_t net64(uint64_t v){return ((uint64_t)net32((uint32_t)v)<<32)|net32((uint32_t)(v>>32));}
#pragma pack(push, 1)
typedef struct { uint32_t magic; uint16_t version, operation; uint32_t flags; uint64_t request_id; uint32_t payload_length; } Header;
#pragma pack(pop)
static SERVICE_STATUS_HANDLE sh; static SERVICE_STATUS ss; static HANDLE stop_event;
static PSID allowed_sid; static wchar_t sid_text[184]; static volatile LONG stopping;
static void status(DWORD state, DWORD error) {
 ss.dwServiceType=SERVICE_WIN32_OWN_PROCESS; ss.dwCurrentState=state; ss.dwWin32ExitCode=error;
 ss.dwWaitHint=state==SERVICE_START_PENDING?5000:0;
 ss.dwControlsAccepted=state==SERVICE_RUNNING?SERVICE_ACCEPT_STOP|SERVICE_ACCEPT_SHUTDOWN:0;
 ss.dwCheckPoint=state==SERVICE_START_PENDING?1:0; if(sh) SetServiceStatus(sh,&ss);
}
static DWORD WINAPI control(DWORD c,DWORD e,LPVOID d,LPVOID x) {
 (void)e;(void)d;(void)x;
 if(c==SERVICE_CONTROL_STOP||c==SERVICE_CONTROL_SHUTDOWN){InterlockedExchange(&stopping,1);if(stop_event)SetEvent(stop_event);status(SERVICE_STOP_PENDING,0);return 0;}
 return ERROR_CALL_NOT_IMPLEMENTED;
}
static BOOL init_sid(const wchar_t *s) {
 if(!s||!*s||wcslen(s)>=_countof(sid_text)||!ConvertStringSidToSidW(s,&allowed_sid))return FALSE;
 if(!IsValidSid(allowed_sid)||FAILED(StringCchCopyW(sid_text,_countof(sid_text),s))){LocalFree(allowed_sid);allowed_sid=NULL;return FALSE;} return TRUE;
}
static BOOL pipe_sa(SECURITY_ATTRIBUTES *sa,PSECURITY_DESCRIPTOR *sd) {
 wchar_t text[512]; if(FAILED(StringCchPrintfW(text,_countof(text),L"D:P(A;;GA;;;SY)(A;;GA;;;BA)(A;;GRGW;;;%s)",sid_text)))return FALSE;
 if(!ConvertStringSecurityDescriptorToSecurityDescriptorW(text,SDDL_REVISION_1,sd,NULL))return FALSE;
 sa->nLength=sizeof(*sa);sa->lpSecurityDescriptor=*sd;sa->bInheritHandle=FALSE;return TRUE;
}
static BOOL readn(HANDLE h,void *p,DWORD n){BYTE *b=p;DWORD d=0;while(d<n){DWORD k=0;if(!ReadFile(h,b+d,n-d,&k,NULL)||!k)return FALSE;d+=k;}return TRUE;}
static BOOL writen(HANDLE h,const void *p,DWORD n){const BYTE *b=p;DWORD d=0;while(d<n){DWORD k=0;if(!WriteFile(h,b+d,n-d,&k,NULL)||!k)return FALSE;d+=k;}return TRUE;}
static BOOL auth(HANDLE pipe) {
 HANDLE token=NULL;TOKEN_USER *u=NULL;DWORD n=0;BOOL ok=FALSE;
 if(!ImpersonateNamedPipeClient(pipe))return FALSE;
 if(!OpenThreadToken(GetCurrentThread(),TOKEN_QUERY,TRUE,&token))goto done;
 GetTokenInformation(token,TokenUser,NULL,0,&n);if(GetLastError()!=ERROR_INSUFFICIENT_BUFFER||!n||n>65536)goto done;
 u=HeapAlloc(GetProcessHeap(),HEAP_ZERO_MEMORY,n);if(u&&GetTokenInformation(token,TokenUser,u,n,&n))ok=EqualSid(u->User.Sid,allowed_sid);
 done:if(u)HeapFree(GetProcessHeap(),0,u);if(token)CloseHandle(token);if(!RevertToSelf())ok=FALSE;return ok;
}
static void client(HANDLE pipe) {
 Header q,r;BYTE payload[MAX_PACKET-sizeof(Header)];DWORD pid=0,available=0;
 if(!auth(pipe)||!GetNamedPipeClientProcessId(pipe,&pid)||!pid||!readn(pipe,&q,sizeof(q)))return;
 q.magic=net32(q.magic);q.version=net16(q.version);q.operation=net16(q.operation);
 q.flags=net32(q.flags);q.request_id=net64(q.request_id);q.payload_length=net32(q.payload_length);
 if(q.magic!=MAGIC||q.version!=VERSION||q.flags||q.payload_length>sizeof(payload))return;
 if(q.payload_length&&!readn(pipe,payload,q.payload_length))return;
 if(!PeekNamedPipe(pipe,NULL,0,NULL,&available,NULL)||available)return;
 ZeroMemory(&r,sizeof(r));r.magic=MAGIC;r.version=VERSION;r.operation=q.operation;r.request_id=q.request_id;
 if(q.operation==1&&!q.payload_length)r.flags=0;
 else if(q.operation>=2&&q.operation<=8)r.flags=3; /* UNSUPPORTED: backend absent */
 else r.flags=1;
 r.magic=net32(r.magic);r.version=net16(r.version);r.operation=net16(r.operation);
 r.flags=net32(r.flags);r.request_id=net64(r.request_id);r.payload_length=net32(r.payload_length);
 (void)writen(pipe,&r,sizeof(r));
}
static void run(void) {
 SECURITY_ATTRIBUTES sa;PSECURITY_DESCRIPTOR sd=NULL;ZeroMemory(&sa,sizeof(sa));
 if(!pipe_sa(&sa,&sd)){status(SERVICE_STOPPED,GetLastError());return;}status(SERVICE_RUNNING,0);
 while(!InterlockedCompareExchange(&stopping,0,0)){
  HANDLE p=CreateNamedPipeW(PIPE_NAME,PIPE_ACCESS_DUPLEX|FILE_FLAG_FIRST_PIPE_INSTANCE,PIPE_TYPE_BYTE|PIPE_READMODE_BYTE|PIPE_WAIT|PIPE_REJECT_REMOTE_CLIENTS,8,MAX_PACKET,MAX_PACKET,1000,&sa);
  if(p==INVALID_HANDLE_VALUE){DWORD e=GetLastError();if(e==ERROR_ACCESS_DENIED||e==ERROR_INVALID_PARAMETER)break;if(WaitForSingleObject(stop_event,500)==WAIT_OBJECT_0)break;continue;}
  if(ConnectNamedPipe(p,NULL)||GetLastError()==ERROR_PIPE_CONNECTED)client(p);
  DisconnectNamedPipe(p);CloseHandle(p);if(WaitForSingleObject(stop_event,0)==WAIT_OBJECT_0)break;
 }
 LocalFree(sd);status(SERVICE_STOPPED,0);
}
static VOID WINAPI service_main(DWORD argc,LPWSTR *argv) {
 DWORD i;const wchar_t *sid=NULL;sh=RegisterServiceCtrlHandlerExW(L"LogicEngineSqliteBroker",control,NULL);if(!sh)return;status(SERVICE_START_PENDING,0);
 for(i=1;i<argc;i++){if(!wcscmp(argv[i],L"--client-sid")&&i+1<argc)sid=argv[++i];else{status(SERVICE_STOPPED,ERROR_INVALID_PARAMETER);return;}}
 if(!init_sid(sid)){status(SERVICE_STOPPED,ERROR_INVALID_SID);return;}
 stop_event=CreateEventW(NULL,TRUE,FALSE,NULL);if(!stop_event){LocalFree(allowed_sid);allowed_sid=NULL;status(SERVICE_STOPPED,GetLastError());return;}
 run();CloseHandle(stop_event);stop_event=NULL;LocalFree(allowed_sid);allowed_sid=NULL;
}
int wmain(void){SERVICE_TABLE_ENTRYW t[]={{L"LogicEngineSqliteBroker",service_main},{NULL,NULL}};if(!StartServiceCtrlDispatcherW(t)){fwprintf(stderr,L"SCM dispatcher failed: %lu\n",GetLastError());return 1;}return 0;}
