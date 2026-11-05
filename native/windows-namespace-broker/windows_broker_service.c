/* Windows SQLite broker SCM host. Only manifest-backed ACCESS and
 * identity-bound sidecar deletion are enabled; file opens/creates still require
 * the client HANDLE-transfer protocol and SQLite VFS integration. */
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <sddl.h>
#include <stdint.h>
#include <stdio.h>
#include <wchar.h>
#include <strsafe.h>
#include "windows_manifest_store.h"
#include "windows_manifest_validator.h"

#ifndef _countof
#define _countof(array) (sizeof(array) / sizeof((array)[0]))
#endif
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
static wchar_t metadata_directory[32768], namespace_root[32768], configured_client_sid[184];
static LE_WIN_MANIFEST_STORE metadata_store;
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
static BOOL readn_timeout(HANDLE h,void *p,DWORD n,DWORD timeout_ms){
 BYTE *b=(BYTE*)p;DWORD done=0;ULONGLONG started=GetTickCount64();
 while(done<n){
  DWORD available=0,chunk=0,read=0,remaining=n-done;
  if(!PeekNamedPipe(h,NULL,0,NULL,&available,NULL))return FALSE;
  if(!available){
   if(GetTickCount64()-started>=timeout_ms){SetLastError(ERROR_TIMEOUT);return FALSE;}
   Sleep(5);continue;
  }
  chunk=available<remaining?available:remaining;
  if(!ReadFile(h,b+done,chunk,&read,NULL)||!read)return FALSE;
  done+=read;
 }
 return TRUE;
}
static BOOL writen(HANDLE h,const void *p,DWORD n){const BYTE *b=p;DWORD d=0;while(d<n){DWORD k=0;if(!WriteFile(h,b+d,n-d,&k,NULL)||!k)return FALSE;d+=k;}return TRUE;}
static BOOL auth(HANDLE pipe) {
 HANDLE token=NULL;TOKEN_USER *u=NULL;DWORD n=0;BOOL ok=FALSE;
 if(!ImpersonateNamedPipeClient(pipe))return FALSE;
 if(!OpenThreadToken(GetCurrentThread(),TOKEN_QUERY,TRUE,&token))goto done;
 GetTokenInformation(token,TokenUser,NULL,0,&n);if(GetLastError()!=ERROR_INSUFFICIENT_BUFFER||!n||n>65536)goto done;
 u=HeapAlloc(GetProcessHeap(),HEAP_ZERO_MEMORY,n);if(u&&GetTokenInformation(token,TokenUser,u,n,&n))ok=EqualSid(u->User.Sid,allowed_sid);
 done:if(u)HeapFree(GetProcessHeap(),0,u);if(token)CloseHandle(token);if(!RevertToSelf())ok=FALSE;return ok;
}
static HANDLE authenticated_process(HANDLE pipe) {
 DWORD pid=0,needed=0;HANDLE process=NULL,token=NULL;TOKEN_USER *user=NULL;BOOL valid=FALSE;
 if(!GetNamedPipeClientProcessId(pipe,&pid)||!pid)return NULL;
 process=OpenProcess(PROCESS_DUP_HANDLE|PROCESS_QUERY_LIMITED_INFORMATION,FALSE,pid);
 if(!process)return NULL;
 if(!OpenProcessToken(process,TOKEN_QUERY,&token))goto failed;
 GetTokenInformation(token,TokenUser,NULL,0,&needed);
 if(GetLastError()!=ERROR_INSUFFICIENT_BUFFER||!needed||needed>65536)goto failed;
 user=HeapAlloc(GetProcessHeap(),HEAP_ZERO_MEMORY,needed);
 if(!user||!GetTokenInformation(token,TokenUser,user,needed,&needed))goto failed;
 valid=EqualSid(user->User.Sid,allowed_sid);
 if(user)HeapFree(GetProcessHeap(),0,user);
 CloseHandle(token);
 if(!valid){CloseHandle(process);return NULL;}
 return process;
 failed:
 if(user)HeapFree(GetProcessHeap(),0,user);
 if(token)CloseHandle(token);
 if(process)CloseHandle(process);
 return NULL;
}
#define LEB_STATUS_OK 0u
#define LEB_STATUS_BAD_REQUEST 1u
#define LEB_STATUS_UNAUTHORIZED 2u
#define LEB_STATUS_UNSUPPORTED 3u
#define LEB_STATUS_INTERNAL 4u
#define LEB_STATUS_NOT_FOUND 5u
static BOOL parse_access_payload(const BYTE *payload,DWORD length,char role[129],char kind[16]) {
 DWORD separator=0,i,role_length,kind_length;
 if(!payload||!length||length>145)return FALSE;
 while(separator<length&&payload[separator]!=0)separator++;
 if(separator==0||separator==length)return FALSE;
 role_length=separator;kind_length=length-separator-1;
 if(role_length>128||kind_length==0||kind_length>=16)return FALSE;
 for(i=0;i<role_length;i++){
  BYTE c=payload[i];
  if(!((c>='A'&&c<='Z')||(c>='a'&&c<='z')||(c>='0'&&c<='9')||c=='.'||c=='_'||c=='-')
     ||(i==0&&!((c>='A'&&c<='Z')||(c>='a'&&c<='z')||(c>='0'&&c<='9'))))return FALSE;
 }
 for(i=separator+1;i<length;i++)if(payload[i]==0||payload[i]<0x21||payload[i]>0x7e)return FALSE;
 memcpy(role,payload,role_length);role[role_length]=0;
 memcpy(kind,payload+separator+1,kind_length);kind[kind_length]=0;
 return !strcmp(kind,"main")||!strcmp(kind,"wal")||!strcmp(kind,"shm")||!strcmp(kind,"journal");
}
static void client(HANDLE pipe) {
 Header q,r;BYTE payload[MAX_PACKET-sizeof(Header)];DWORD available=0;HANDLE process=NULL;
 DWORD response_status=LEB_STATUS_BAD_REQUEST;BOOL exists=FALSE;
 char role[129],kind[16];
 if(!auth(pipe)||(process=authenticated_process(pipe))==NULL||!readn_timeout(pipe,&q,sizeof(q),5000))goto done;
 q.magic=net32(q.magic);q.version=net16(q.version);q.operation=net16(q.operation);
 q.flags=net32(q.flags);q.request_id=net64(q.request_id);q.payload_length=net32(q.payload_length);
 if(q.magic!=MAGIC||q.version!=VERSION||q.flags||q.payload_length>sizeof(payload))goto done;
 if(q.payload_length&&!readn_timeout(pipe,payload,q.payload_length,5000))goto done;
 if(!PeekNamedPipe(pipe,NULL,0,NULL,&available,NULL)||available)goto done;
 if(q.operation==1&&q.payload_length==0)response_status=LEB_STATUS_OK;
 else if(q.operation==4){
  DWORD operation_error=ERROR_SUCCESS;
  if(!parse_access_payload(payload,q.payload_length,role,kind)||strcmp(kind,"main")==0)
   response_status=LEB_STATUS_BAD_REQUEST;
  else if(!le_win_store_lock(&metadata_store))response_status=LEB_STATUS_INTERNAL;
  else{
   if(le_win_delete_role_sidecar(&metadata_store,namespace_root,role,kind))
    response_status=LEB_STATUS_OK;
   else{
    operation_error=GetLastError();
    response_status=operation_error==ERROR_FILE_NOT_FOUND?LEB_STATUS_NOT_FOUND:LEB_STATUS_INTERNAL;
   }
   le_win_store_unlock(&metadata_store);
  }
 }
 else if(q.operation==8){
  if(!parse_access_payload(payload,q.payload_length,role,kind))response_status=LEB_STATUS_BAD_REQUEST;
  else if(!le_win_store_lock(&metadata_store))response_status=LEB_STATUS_INTERNAL;
  else{
   if(le_win_access_role_file(&metadata_store,namespace_root,role,kind,&exists))
    response_status=exists?LEB_STATUS_OK:LEB_STATUS_NOT_FOUND;
   else response_status=LEB_STATUS_INTERNAL;
   le_win_store_unlock(&metadata_store);
  }
 }else if(q.operation>=2&&q.operation<=8)response_status=LEB_STATUS_UNSUPPORTED;
 else response_status=LEB_STATUS_UNSUPPORTED;
 ZeroMemory(&r,sizeof(r));r.magic=net32(MAGIC);r.version=net16(VERSION);
 r.operation=net16(q.operation);r.flags=net32(response_status);
 r.request_id=net64(q.request_id);r.payload_length=0;
 (void)writen(pipe,&r,sizeof(r));
 done:
 if(process)CloseHandle(process);
}
static int startup_recover(
    LE_WIN_MANIFEST_STORE *store,
    const unsigned char *manifest, DWORD manifest_length,
    const unsigned char *intent, DWORD intent_length,
    void *context) {
 if(intent||intent_length)
  return le_win_recover_lifecycle_intent(store,manifest,manifest_length,intent,intent_length,(const wchar_t*)context);
 return le_win_reconcile_manifest_namespace(manifest,manifest_length,(const wchar_t*)context);
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
 (void)argc;(void)argv;
 sh=RegisterServiceCtrlHandlerExW(L"LogicEngineSqliteBroker",control,NULL);if(!sh)return;status(SERVICE_START_PENDING,0);
 if(!metadata_directory[0]||!namespace_root[0]||!allowed_sid){status(SERVICE_STOPPED,ERROR_INVALID_PARAMETER);return;}
 stop_event=CreateEventW(NULL,TRUE,FALSE,NULL);if(!stop_event){LocalFree(allowed_sid);allowed_sid=NULL;status(SERVICE_STOPPED,GetLastError());return;}
 if(!le_win_store_open_validated(&metadata_store,metadata_directory)
     ||!le_win_store_startup_recover(&metadata_store,startup_recover,namespace_root)){
  DWORD error=GetLastError();le_win_store_close(&metadata_store);
  CloseHandle(stop_event);stop_event=NULL;LocalFree(allowed_sid);allowed_sid=NULL;
  status(SERVICE_STOPPED,error?error:ERROR_RECOVERY_FAILURE);return;
 }
 run();le_win_store_close(&metadata_store);CloseHandle(stop_event);stop_event=NULL;LocalFree(allowed_sid);allowed_sid=NULL;
}
int wmain(int argc,wchar_t **argv){
 SERVICE_TABLE_ENTRYW t[]={{L"LogicEngineSqliteBroker",service_main},{NULL,NULL}};
 int i;BOOL have_sid=FALSE,have_metadata=FALSE,have_namespace=FALSE;
 for(i=1;i<argc;i++){
  if(!wcscmp(argv[i],L"--client-sid")&&i+1<argc){
   if(FAILED(StringCchCopyW(configured_client_sid,_countof(configured_client_sid),argv[++i])))return 2;
   have_sid=TRUE;
  }else if(!wcscmp(argv[i],L"--metadata-dir")&&i+1<argc){
   if(FAILED(StringCchCopyW(metadata_directory,_countof(metadata_directory),argv[++i])))return 2;
   have_metadata=TRUE;
  }else if(!wcscmp(argv[i],L"--namespace-root")&&i+1<argc){
   if(FAILED(StringCchCopyW(namespace_root,_countof(namespace_root),argv[++i])))return 2;
   have_namespace=TRUE;
  }else return 2;
 }
 if(!have_sid||!have_metadata||!have_namespace||!init_sid(configured_client_sid)){
  fwprintf(stderr,L"Invalid broker service configuration.\n");return 2;
 }
 if(!StartServiceCtrlDispatcherW(t)){
  DWORD error=GetLastError();if(allowed_sid){LocalFree(allowed_sid);allowed_sid=NULL;}
  fwprintf(stderr,L"SCM dispatcher failed: %lu\n",error);return 1;
 }
 return 0;
}
