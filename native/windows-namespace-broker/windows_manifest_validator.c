#ifdef _WIN32
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <stdint.h>
#include <stddef.h>
#include <string.h>
#include <stdlib.h>
#include <ctype.h>
#include "windows_manifest_validator.h"
#include "../secure-vfs-probe/windows_relative_open.h"
#include <strsafe.h>
#define LE_COUNT_OF(value) (sizeof(value) / sizeof((value)[0]))

#define LE_JSON_MAX_NODES 65536u
#define LE_JSON_MAX_DEPTH 32u
#define LE_JSON_MAX_BYTES (1024u * 1024u)

typedef enum { J_OBJECT=1, J_ARRAY=2, J_STRING=3, J_NUMBER=4, J_TRUE=5, J_FALSE=6, J_NULL=7 } JTYPE;
typedef struct { JTYPE type; DWORD start,end,first,last,next,count; } JNODE;
typedef struct { const unsigned char *s; DWORD n,pos,nodes; JNODE *v; } JPARSER;

static void jws(JPARSER *p){while(p->pos<p->n&&(p->s[p->pos]==' '||p->s[p->pos]=='\t'||p->s[p->pos]=='\r'||p->s[p->pos]=='\n'))p->pos++;}
static int jnode(JPARSER *p,JTYPE type,DWORD start,DWORD *id){
 if(p->nodes>=LE_JSON_MAX_NODES)return 0;
 *id=p->nodes++;p->v[*id].type=type;p->v[*id].start=start;p->v[*id].end=0;
 p->v[*id].first=p->v[*id].last=p->v[*id].next=0xffffffffu;p->v[*id].count=0;return 1;
}
static int jstring(JPARSER *p,DWORD *id){
 DWORD start=++p->pos;
 while(p->pos<p->n&&p->s[p->pos]!='"'){
  unsigned char c=p->s[p->pos++];
  /* Canonical JSON string subset: escaped strings are unnecessary for this
     schema and rejecting them avoids key-equivalence ambiguity. */
  if(c=='\\'||c<0x20)return 0;
 }
 if(p->pos>=p->n)return 0;
 if(!jnode(p,J_STRING,start,id))return 0;
 p->v[*id].end=p->pos;p->pos++;return 1;
}
static int jvalue(JPARSER *p,DWORD depth,DWORD *id);
static int jappend(JPARSER *p,DWORD parent,DWORD child){
 if(p->v[parent].last==0xffffffffu)p->v[parent].first=child;
 else p->v[p->v[parent].last].next=child;
 p->v[parent].last=child;p->v[parent].count++;return 1;
}
static int jobject(JPARSER *p,DWORD depth,DWORD *id){
 DWORD start=p->pos++,key,value,scan;
 if(!jnode(p,J_OBJECT,start,id))return 0;
 jws(p);if(p->pos<p->n&&p->s[p->pos]=='}'){p->pos++;p->v[*id].end=p->pos;return 1;}
 for(;;){
  if(p->pos>=p->n||p->s[p->pos]!='"'||!jstring(p,&key))return 0;
  for(scan=p->v[*id].first;scan!=0xffffffffu;scan=p->v[p->v[scan].next].next){
   DWORD prior=p->v[scan].next;
   if(p->v[key].end-p->v[key].start==p->v[scan].end-p->v[scan].start
       &&memcmp(p->s+p->v[key].start,p->s+p->v[scan].start,p->v[key].end-p->v[key].start)==0)return 0;
   (void)prior;
  }
  jws(p);if(p->pos>=p->n||p->s[p->pos++]!=':')return 0;jws(p);
  if(!jvalue(p,depth+1,&value))return 0;
  jappend(p,*id,key);jappend(p,*id,value);jws(p);
  if(p->pos>=p->n)return 0;
  if(p->s[p->pos]=='}'){p->pos++;p->v[*id].end=p->pos;return 1;}
  if(p->s[p->pos++]!=',')return 0;jws(p);
 }
}
static int jarray(JPARSER *p,DWORD depth,DWORD *id){
 DWORD start=p->pos++,value;
 if(!jnode(p,J_ARRAY,start,id))return 0;
 jws(p);if(p->pos<p->n&&p->s[p->pos]==']'){p->pos++;p->v[*id].end=p->pos;return 1;}
 for(;;){if(!jvalue(p,depth+1,&value))return 0;jappend(p,*id,value);jws(p);
  if(p->pos>=p->n)return 0;if(p->s[p->pos]==']'){p->pos++;p->v[*id].end=p->pos;return 1;}
  if(p->s[p->pos++]!=',')return 0;jws(p);
 }
}
static int jvalue(JPARSER *p,DWORD depth,DWORD *id){
 DWORD start;unsigned char c;
 if(depth>LE_JSON_MAX_DEPTH)return 0;jws(p);if(p->pos>=p->n)return 0;c=p->s[p->pos];
 if(c=='{')return jobject(p,depth,id);if(c=='[')return jarray(p,depth,id);if(c=='"')return jstring(p,id);
 start=p->pos;
 if(c=='t'&&p->n-p->pos>=4&&!memcmp(p->s+p->pos,"true",4)){p->pos+=4;return jnode(p,J_TRUE,start,id)&&(p->v[*id].end=p->pos,1);}
 if(c=='f'&&p->n-p->pos>=5&&!memcmp(p->s+p->pos,"false",5)){p->pos+=5;return jnode(p,J_FALSE,start,id)&&(p->v[*id].end=p->pos,1);}
 if(c=='n'&&p->n-p->pos>=4&&!memcmp(p->s+p->pos,"null",4)){p->pos+=4;return jnode(p,J_NULL,start,id)&&(p->v[*id].end=p->pos,1);}
 if(c=='-'||(c>='0'&&c<='9')){
  if(c=='-')return 0;
  if(c=='0')p->pos++;else{while(p->pos<p->n&&p->s[p->pos]>='0'&&p->s[p->pos]<='9')p->pos++;}
  if(p->pos<p->n&&(p->s[p->pos]=='.'||p->s[p->pos]=='e'||p->s[p->pos]=='E'))return 0;
  if(!jnode(p,J_NUMBER,start,id))return 0;p->v[*id].end=p->pos;return 1;
 }
 return 0;
}
static int jeq(JPARSER*p,DWORD id,const char*s){size_t n=strlen(s);return p->v[id].type==J_STRING&&p->v[id].end-p->v[id].start==n&&!memcmp(p->s+p->v[id].start,s,n);}
static DWORD jget(JPARSER*p,DWORD obj,const char*key){
 DWORD k,v; if(p->v[obj].type!=J_OBJECT)return 0xffffffffu;
 for(k=p->v[obj].first;k!=0xffffffffu;){v=p->v[k].next;if(jeq(p,k,key))return v;k=p->v[v].next;}return 0xffffffffu;
}
static int jkeys(JPARSER*p,DWORD obj,const char**keys,DWORD count){
 DWORD k,v,i=0;if(p->v[obj].type!=J_OBJECT||p->v[obj].count!=count*2)return 0;
 for(k=p->v[obj].first;k!=0xffffffffu;){v=p->v[k].next;for(i=0;i<count&&!jeq(p,k,keys[i]);i++);if(i==count)return 0;k=p->v[v].next;}return 1;
}
static int jnum(JPARSER*p,DWORD id,uint64_t min,uint64_t max,uint64_t*out){
 uint64_t n=0;DWORD i;if(id==0xffffffffu||p->v[id].type!=J_NUMBER)return 0;
 for(i=p->v[id].start;i<p->v[id].end;i++){unsigned d=p->s[i]-'0';if(n>(UINT64_MAX-d)/10)return 0;n=n*10+d;}
 if(n<min||n>max)return 0;if(out)*out=n;return 1;
}
static int jhex(JPARSER*p,DWORD id,DWORD length,int lower){
 DWORD i;if(id==0xffffffffu||p->v[id].type!=J_STRING||p->v[id].end-p->v[id].start!=length)return 0;
 for(i=p->v[id].start;i<p->v[id].end;i++){unsigned char c=p->s[i];if(!((c>='0'&&c<='9')||(c>='a'&&c<='f')||(!lower&&c>='A'&&c<='F')))return 0;}return 1;
}
static int jidentity(JPARSER*p,DWORD id){
 static const char*k[]={"kind","volumeSerial","fileId"};DWORD a=jget(p,id,"kind");
 return jkeys(p,id,k,3)&&jeq(p,a,"windows")&&jhex(p,jget(p,id,"volumeSerial"),16,0)&&jhex(p,jget(p,id,"fileId"),32,0);
}
static int jrole_name(JPARSER*p,DWORD id){
 DWORD i;if(id==0xffffffffu||p->v[id].type!=J_STRING||p->v[id].end==p->v[id].start||p->v[id].end-p->v[id].start>128)return 0;
 for(i=p->v[id].start;i<p->v[id].end;i++){unsigned char c=p->s[i];if(!((c>='A'&&c<='Z')||(c>='a'&&c<='z')||(c>='0'&&c<='9')||c=='.'||c=='_'||c=='-')||(i==p->v[id].start&&!((c>='A'&&c<='Z')||(c>='a'&&c<='z')||(c>='0'&&c<='9'))))return 0;}return 1;
}
static int jcomponent(JPARSER*p,DWORD id){
 DWORD i;if(id==0xffffffffu||p->v[id].type!=J_STRING||p->v[id].end==p->v[id].start||p->v[id].end-p->v[id].start>255)return 0;
 for(i=p->v[id].start;i<p->v[id].end;i++){unsigned char c=p->s[i];if(c<0x20||c=='\\'||c=='/'||c==':'||c=='*'||c=='?'||c=='"'||c=='<'||c=='>'||c=='|' )return 0;}
 return p->s[p->v[id].end-1]!='.'&&p->s[p->v[id].end-1]!=' ';
}
static int jidentity_equal(JPARSER*p,DWORD a,DWORD b){
 DWORD av=jget(p,a,"volumeSerial"),af=jget(p,a,"fileId"),bv=jget(p,b,"volumeSerial"),bf=jget(p,b,"fileId");
 return p->v[av].end-p->v[av].start==p->v[bv].end-p->v[bv].start
 &&p->v[af].end-p->v[af].start==p->v[bf].end-p->v[bf].start
 &&_strnicmp((const char*)p->s+p->v[av].start,(const char*)p->s+p->v[bv].start,p->v[av].end-p->v[av].start)==0
 &&_strnicmp((const char*)p->s+p->v[af].start,(const char*)p->s+p->v[bf].start,p->v[af].end-p->v[af].start)==0;
}
static int jclaim_identity(JPARSER*p,DWORD id,DWORD*ids,DWORD*count,DWORD capacity){
 DWORD i;if(!jidentity(p,id)||*count>=capacity)return 0;
 for(i=0;i<*count;i++)if(jidentity_equal(p,id,ids[i]))return 0;
 ids[(*count)++]=id;return 1;
}
static int jvalidate_manifest(JPARSER*p,DWORD root){
 static const char*top[]={"schemaVersion","generation","platform","metadataRootIdentity","filesystemPolicy","roles"};
 static const char*policy[]={"filesystem","identitySource","directoryMutationBoundary"};
 static const char*rolekeys[]={"role","parentComponents","parentIdentities","databaseBasename","databaseIdentity","state","sidecars"};
 static const char*sidekeys[]={"kind","identity","state","generation"};
 DWORD roles,policyid,rootid,role,side,i,dbid;uint64_t gen,sg;const char*kind;DWORD role_names[32],physical_ids[8192],physical_count=0;DWORD dbcount=0;
 if(!jkeys(p,root,top,6)||!jnum(p,jget(p,root,"schemaVersion"),1,1,NULL)||!jnum(p,jget(p,root,"generation"),1,9007199254740991ULL,&gen)||!jeq(p,jget(p,root,"platform"),"windows"))return 0;
 rootid=jget(p,root,"metadataRootIdentity");if(!jclaim_identity(p,rootid,physical_ids,&physical_count,8192))return 0;
 policyid=jget(p,root,"filesystemPolicy");
 if(!jkeys(p,policyid,policy,3)||!jeq(p,jget(p,policyid,"filesystem"),"NTFS")||!jeq(p,jget(p,policyid,"identitySource"),"opened-handle")||!jeq(p,jget(p,policyid,"directoryMutationBoundary"),"dedicated-service-identity"))return 0;
 roles=jget(p,root,"roles");if(p->v[roles].type!=J_ARRAY||p->v[roles].count==0||p->v[roles].count>32)return 0;
 for(role=p->v[roles].first;role!=0xffffffffu;role=p->v[role].next){
  DWORD roleid=jget(p,role,"role"),parents=jget(p,role,"parentIdentities"),components=jget(p,role,"parentComponents"),sides=jget(p,role,"sidecars");
  DWORD pc,pi,previous;unsigned active[3]={0,0,0};uint64_t active_gen[3]={0,0,0},retired_gen[3]={0,0,0};
  if(!jkeys(p,role,rolekeys,7)||!jrole_name(p,roleid)||!jeq(p,jget(p,role,"state"),"active")||!jcomponent(p,jget(p,role,"databaseBasename"))||!jidentity(p,jget(p,role,"databaseIdentity"))||p->v[parents].type!=J_ARRAY||p->v[components].type!=J_ARRAY||p->v[parents].count!=p->v[components].count||p->v[parents].count>256||p->v[sides].type!=J_ARRAY)return 0;
  for(i=0;i<32;i++)if(i<dbcount&&p->v[role_names[i]].end-p->v[role_names[i]].start==p->v[roleid].end-p->v[roleid].start&&!memcmp(p->s+p->v[role_names[i]].start,p->s+p->v[roleid].start,p->v[roleid].end-p->v[roleid].start))return 0;
  role_names[dbcount]=roleid;dbcount++;
  for(pc=p->v[components].first,pi=p->v[parents].first;pc!=0xffffffffu;pc=p->v[pc].next,pi=p->v[pi].next)if(!jcomponent(p,pc)||!jclaim_identity(p,pi,physical_ids,&physical_count,8192))return 0;
  dbid=jget(p,role,"databaseIdentity");if(!jclaim_identity(p,dbid,physical_ids,&physical_count,8192))return 0;
  for(side=p->v[sides].first;side!=0xffffffffu;side=p->v[side].next){if(!jkeys(p,side,sidekeys,4))return 0;
   kind=jeq(p,jget(p,side,"kind"),"wal")?"wal":jeq(p,jget(p,side,"kind"),"shm")?"shm":jeq(p,jget(p,side,"kind"),"journal")?"journal":NULL;
   if(!kind||!jclaim_identity(p,jget(p,side,"identity"),physical_ids,&physical_count,8192)||!jnum(p,jget(p,side,"generation"),1,gen,&sg))return 0;
   {
    unsigned ix=!strcmp(kind,"wal")?0:!strcmp(kind,"shm")?1:2;
    for(previous=p->v[sides].first;previous!=side;previous=p->v[previous].next){
     uint64_t oldgen;
     if(jeq(p,jget(p,previous,"kind"),kind)
         &&jnum(p,jget(p,previous,"generation"),1,gen,&oldgen)&&oldgen==sg)return 0;
    }
    if(jeq(p,jget(p,side,"state"),"active")){if(++active[ix]>1)return 0;active_gen[ix]=sg;}
    else if(jeq(p,jget(p,side,"state"),"retired")){if(sg>retired_gen[ix])retired_gen[ix]=sg;}
    else return 0;
   }

  }
  for(i=0;i<3;i++)if(active_gen[i]&&active_gen[i]<=retired_gen[i])return 0;
 }
 return 1;
}
static int jvalidate_intent(JPARSER*p,DWORD root){
 static const char*keys[]={"baseGeneration","basename","expectedIdentity","kind","operation","operationId","role","schemaVersion","targetGeneration"};
 DWORD op=jget(p,root,"operation"),expected=jget(p,root,"expectedIdentity");uint64_t base,target;
 if(!jkeys(p,root,keys,9)||!jnum(p,jget(p,root,"schemaVersion"),1,1,NULL)||!jhex(p,jget(p,root,"operationId"),32,1)||!jrole_name(p,jget(p,root,"role"))||!jcomponent(p,jget(p,root,"basename"))||!jnum(p,jget(p,root,"baseGeneration"),1,9007199254740990ULL,&base)||!jnum(p,jget(p,root,"targetGeneration"),2,9007199254740991ULL,&target)||target!=base+1)return 0;
 if(!(jeq(p,jget(p,root,"kind"),"wal")||jeq(p,jget(p,root,"kind"),"shm")||jeq(p,jget(p,root,"kind"),"journal")))return 0;
 if(jeq(p,op,"delete-sidecar"))return jidentity(p,expected);
 return jeq(p,op,"create-sidecar")&&p->v[expected].type==J_NULL;
}
static int jvalidate(const unsigned char*bytes,DWORD length,int intent){
 JPARSER p;DWORD root;int ok=0;
 if(!bytes||!length||length>LE_JSON_MAX_BYTES||(length>=3&&bytes[0]==0xef&&bytes[1]==0xbb&&bytes[2]==0xbf))return 0;
 if(!MultiByteToWideChar(CP_UTF8,MB_ERR_INVALID_CHARS,(LPCCH)bytes,(int)length,NULL,0))return 0;
 ZeroMemory(&p,sizeof(p));p.s=bytes;p.n=length;p.v=HeapAlloc(GetProcessHeap(),HEAP_ZERO_MEMORY,sizeof(JNODE)*LE_JSON_MAX_NODES);if(!p.v)return 0;
 jws(&p);if(jvalue(&p,0,&root)){jws(&p);if(p.pos==p.n&&p.v[root].type==J_OBJECT)ok=intent?jvalidate_intent(&p,root):jvalidate_manifest(&p,root);}
 HeapFree(GetProcessHeap(),0,p.v);return ok;
}
static unsigned jhex_nibble(unsigned char c){
 if(c>='0'&&c<='9')return c-'0';
 if(c>='a'&&c<='f')return c-'a'+10;
 if(c>='A'&&c<='F')return c-'A'+10;
 return 16;
}
static int jwide(JPARSER*p,DWORD id,wchar_t*out,DWORD capacity){
 DWORD bytes,needed;
 if(id==0xffffffffu||p->v[id].type!=J_STRING||!out||capacity==0)return 0;
 bytes=p->v[id].end-p->v[id].start;
 needed=MultiByteToWideChar(CP_UTF8,MB_ERR_INVALID_CHARS,(LPCCH)(p->s+p->v[id].start),(int)bytes,NULL,0);
 if(!needed||needed>=capacity)return 0;
 if(!MultiByteToWideChar(CP_UTF8,MB_ERR_INVALID_CHARS,(LPCCH)(p->s+p->v[id].start),(int)bytes,out,(int)capacity))return 0;
 out[needed]=0;return 1;
}
static int jnative_identity(JPARSER*p,DWORD id,LogicEngineWinFileIdentity*out){
 DWORD vs=jget(p,id,"volumeSerial"),fid=jget(p,id,"fileId"),i;
 ULONGLONG serial=0;
 if(!out||!jidentity(p,id))return 0;
 for(i=p->v[vs].start;i<p->v[vs].end;i++){unsigned n=jhex_nibble(p->s[i]);if(n>15)return 0;serial=(serial<<4)|n;}
 ZeroMemory(out,sizeof(*out));out->volume_serial=serial;
 for(i=0;i<16;i++){unsigned hi=jhex_nibble(p->s[p->v[fid].start+i*2]);unsigned lo=jhex_nibble(p->s[p->v[fid].start+i*2+1]);if(hi>15||lo>15)return 0;out->file_id.Identifier[i]=(BYTE)((hi<<4)|lo);}
 return 1;
}
static HANDLE jopen_verified(HANDLE parent,const wchar_t*name,
    const LogicEngineWinFileIdentity*expected,int directory){
 LogicEngineWinFileIdentity observed;FILE_ATTRIBUTE_TAG_INFO tag;HANDLE opened;
 ACCESS_MASK access=FILE_READ_ATTRIBUTES;
 ULONG options=directory?FILE_DIRECTORY_FILE:FILE_NON_DIRECTORY_FILE;
 if(directory)access|=FILE_LIST_DIRECTORY|FILE_TRAVERSE|READ_CONTROL;
 opened=logic_engine_win_open_relative(parent,name,access,
   FILE_SHARE_READ|FILE_SHARE_WRITE|FILE_SHARE_DELETE,FILE_OPEN,options,
   directory?FILE_ATTRIBUTE_DIRECTORY:FILE_ATTRIBUTE_NORMAL,NULL,&observed);
 if(opened==INVALID_HANDLE_VALUE)return INVALID_HANDLE_VALUE;
 if(!GetFileInformationByHandleEx(opened,FileAttributeTagInfo,&tag,sizeof(tag))
    ||(tag.FileAttributes&FILE_ATTRIBUTE_REPARSE_POINT)!=0
    ||(((tag.FileAttributes&FILE_ATTRIBUTE_DIRECTORY)!=0)!=(directory!=0))
    ||!logic_engine_win_identity_equal(expected,&observed)){
  CloseHandle(opened);SetLastError(ERROR_ACCESS_DENIED);return INVALID_HANDLE_VALUE;
 }
 return opened;
}
static int jntfs_handle(HANDLE directory){
 wchar_t final_path[32768],volume_root[MAX_PATH],filesystem[MAX_PATH];DWORD n;
 n=GetFinalPathNameByHandleW(directory,final_path,(DWORD)LE_COUNT_OF(final_path),FILE_NAME_NORMALIZED|VOLUME_NAME_GUID);
 if(!n||n>=LE_COUNT_OF(final_path)
    ||!GetVolumePathNameW(final_path,volume_root,(DWORD)LE_COUNT_OF(volume_root))
    ||!GetVolumeInformationW(volume_root,NULL,0,NULL,NULL,NULL,filesystem,(DWORD)LE_COUNT_OF(filesystem))
    ||wcscmp(filesystem,L"NTFS")!=0){SetLastError(ERROR_NOT_SUPPORTED);return 0;}
 return 1;
}
static int jreconcile_role(JPARSER*p,DWORD role,HANDLE root){
 DWORD components=jget(p,role,"parentComponents"),parents=jget(p,role,"parentIdentities");
 DWORD component,parent_id,side,sides=jget(p,role,"sidecars"),dbid=jget(p,role,"databaseIdentity");
 wchar_t name[512],database[512],sidecar_name[768];HANDLE current=root,next,file;
 LogicEngineWinFileIdentity expected;int owns_current=0;
 if(!jwide(p,jget(p,role,"databaseBasename"),database,(DWORD)LE_COUNT_OF(database)))return 0;
 for(component=p->v[components].first,parent_id=p->v[parents].first;
     component!=0xffffffffu;component=p->v[component].next,parent_id=p->v[parent_id].next){
  if(!jwide(p,component,name,(DWORD)LE_COUNT_OF(name))||!jnative_identity(p,parent_id,&expected))goto fail;
  next=jopen_verified(current,name,&expected,1);if(next==INVALID_HANDLE_VALUE)goto fail;
  if(owns_current)CloseHandle(current);
  current=next;owns_current=1;
 }
 if(!jnative_identity(p,dbid,&expected))goto fail;
 file=jopen_verified(current,database,&expected,0);if(file==INVALID_HANDLE_VALUE)goto fail;
 CloseHandle(file);
 for(side=p->v[sides].first;side!=0xffffffffu;side=p->v[side].next){
  DWORD kind=jget(p,side,"kind"),state=jget(p,side,"state"),identity=jget(p,side,"identity");
  const wchar_t*suffix=jeq(p,kind,"wal")?L"-wal":jeq(p,kind,"shm")?L"-shm":L"-journal";
  DWORD other;int has_active=0;
  if(FAILED(StringCchCopyW(sidecar_name,LE_COUNT_OF(sidecar_name),database))
      ||FAILED(StringCchCatW(sidecar_name,LE_COUNT_OF(sidecar_name),suffix)))goto fail;
  if(jeq(p,state,"active")){
   if(!jnative_identity(p,identity,&expected))goto fail;
   file=jopen_verified(current,sidecar_name,&expected,0);if(file==INVALID_HANDLE_VALUE)goto fail;
   CloseHandle(file);
  }else{
   for(other=p->v[sides].first;other!=0xffffffffu;other=p->v[other].next){
    if(jeq(p,jget(p,other,"kind"),jeq(p,kind,"wal")?"wal":jeq(p,kind,"shm")?"shm":"journal")
       &&jeq(p,jget(p,other,"state"),"active")){has_active=1;break;}
   }
   if(!has_active){
    file=logic_engine_win_open_relative(current,sidecar_name,FILE_READ_ATTRIBUTES,
      FILE_SHARE_READ|FILE_SHARE_WRITE|FILE_SHARE_DELETE,FILE_OPEN,
      FILE_NON_DIRECTORY_FILE,FILE_ATTRIBUTE_NORMAL,NULL,NULL);
    if(file!=INVALID_HANDLE_VALUE){CloseHandle(file);SetLastError(ERROR_FILE_INVALID);goto fail;}
    if(GetLastError()!=ERROR_FILE_NOT_FOUND)goto fail;
   }
  }
 }
 if(owns_current)CloseHandle(current);
 return 1;
fail:
 if(owns_current)CloseHandle(current);
 return 0;
}
int le_win_reconcile_manifest_namespace(const unsigned char*bytes,DWORD length,const wchar_t*namespace_root){
 JPARSER p;DWORD root,roles,role;HANDLE root_parent=INVALID_HANDLE_VALUE,root_handle=INVALID_HANDLE_VALUE;
 LogicEngineWinDirectoryAnchor anchor;LogicEngineWinFileIdentity expected;int ok=0;
 if(!bytes||!namespace_root||!length||length>LE_JSON_MAX_BYTES)return 0;
 if(!MultiByteToWideChar(CP_UTF8,MB_ERR_INVALID_CHARS,(LPCCH)bytes,(int)length,NULL,0))return 0;
 ZeroMemory(&p,sizeof(p));ZeroMemory(&anchor,sizeof(anchor));p.s=bytes;p.n=length;
 p.v=HeapAlloc(GetProcessHeap(),HEAP_ZERO_MEMORY,sizeof(JNODE)*LE_JSON_MAX_NODES);if(!p.v)return 0;
 jws(&p);
 if(!jvalue(&p,0,&root))goto done;
 jws(&p);if(p.pos!=p.n||p.v[root].type!=J_OBJECT||!jvalidate_manifest(&p,root))goto done;
 if(!logic_engine_win_anchor_path(namespace_root,&anchor))goto done;
 root_parent=anchor.parent;
 if(!jnative_identity(&p,jget(&p,root,"metadataRootIdentity"),&expected))goto done;
 root_handle=jopen_verified(root_parent,anchor.basename,&expected,1);
 if(root_handle==INVALID_HANDLE_VALUE)goto done;
 roles=jget(&p,root,"roles");
 for(role=p.v[roles].first;role!=0xffffffffu;role=p.v[role].next)
  if(!jreconcile_role(&p,role,root_handle))goto done;
 ok=1;
done:
 if(root_handle!=INVALID_HANDLE_VALUE)CloseHandle(root_handle);
 if(root_parent!=INVALID_HANDLE_VALUE)CloseHandle(root_parent);
 if(anchor.basename)HeapFree(GetProcessHeap(),0,anchor.basename);
 HeapFree(GetProcessHeap(),0,p.v);
 return ok;
}


static int jopen_role_parent(JPARSER*p,DWORD role,HANDLE root,HANDLE*out){
 DWORD components=jget(p,role,"parentComponents"),parents=jget(p,role,"parentIdentities");
 DWORD component,parent_id;HANDLE current=root,next;int owns=0;wchar_t name[512];LogicEngineWinFileIdentity expected;
 for(component=p->v[components].first,parent_id=p->v[parents].first;
     component!=0xffffffffu;component=p->v[component].next,parent_id=p->v[parent_id].next){
  if(!jwide(p,component,name,(DWORD)LE_COUNT_OF(name))||!jnative_identity(p,parent_id,&expected))goto fail;
  next=jopen_verified(current,name,&expected,1);if(next==INVALID_HANDLE_VALUE)goto fail;
  if(owns)CloseHandle(current);current=next;owns=1;
 }
 if(!owns){
  if(!DuplicateHandle(GetCurrentProcess(),root,GetCurrentProcess(),&current,
      0,FALSE,DUPLICATE_SAME_ACCESS))return 0;
  owns=1;
 }
 *out=current;return 1;
fail:
 if(owns)CloseHandle(current);return 0;
}
static int jremove_uncommitted_sidecar(HANDLE parent,const wchar_t*basename){
 HANDLE file;FILE_ATTRIBUTE_TAG_INFO tag;FILE_DISPOSITION_INFO disposition;
 file=logic_engine_win_open_relative(parent,basename,DELETE|FILE_READ_ATTRIBUTES,
   FILE_SHARE_READ|FILE_SHARE_WRITE|FILE_SHARE_DELETE,FILE_OPEN,
   FILE_NON_DIRECTORY_FILE,FILE_ATTRIBUTE_NORMAL,NULL,NULL);
 if(file==INVALID_HANDLE_VALUE)return GetLastError()==ERROR_FILE_NOT_FOUND;
 if(!GetFileInformationByHandleEx(file,FileAttributeTagInfo,&tag,sizeof(tag))
    ||(tag.FileAttributes&(FILE_ATTRIBUTE_DIRECTORY|FILE_ATTRIBUTE_REPARSE_POINT))!=0){
  CloseHandle(file);SetLastError(ERROR_ACCESS_DENIED);return 0;
 }
 disposition.DeleteFile=TRUE;
 if(!SetFileInformationByHandle(file,FileDispositionInfo,&disposition,sizeof(disposition))){
  CloseHandle(file);return 0;
 }
 if(!CloseHandle(file))return 0;
 return FlushFileBuffers(parent)!=0;
}
int le_win_recover_create_intent(const unsigned char*manifest,DWORD manifest_length,
 const unsigned char*intent,DWORD intent_length,const wchar_t*namespace_root){
 JPARSER p,q;DWORD root,roles,role,side,match=0xffffffffu,ir,kind,op,role_name;
 DWORD dbname,baseid,targetid;uint64_t generation,base,target;
 wchar_t database[512],expected_basename[768],actual_basename[768];
 const wchar_t*suffix;HANDLE anchor_parent=INVALID_HANDLE_VALUE,root_handle=INVALID_HANDLE_VALUE,parent=INVALID_HANDLE_VALUE;
 LogicEngineWinDirectoryAnchor anchor;LogicEngineWinFileIdentity expected;int owns_parent=0,ok=0;
 if(!manifest||!intent||!namespace_root||!manifest_length||!intent_length)return 0;
 ZeroMemory(&p,sizeof(p));ZeroMemory(&q,sizeof(q));ZeroMemory(&anchor,sizeof(anchor));
 p.s=manifest;p.n=manifest_length;q.s=intent;q.n=intent_length;
 p.v=HeapAlloc(GetProcessHeap(),HEAP_ZERO_MEMORY,sizeof(JNODE)*LE_JSON_MAX_NODES);
 q.v=HeapAlloc(GetProcessHeap(),HEAP_ZERO_MEMORY,sizeof(JNODE)*LE_JSON_MAX_NODES);
 if(!p.v||!q.v)goto done;
 jws(&p);if(!jvalue(&p,0,&root))goto done;jws(&p);
 if(p.pos!=p.n||p.v[root].type!=J_OBJECT||!jvalidate_manifest(&p,root))goto done;
 jws(&q);if(!jvalue(&q,0,&ir))goto done;jws(&q);
 if(q.pos!=q.n||q.v[ir].type!=J_OBJECT||!jvalidate_intent(&q,ir))goto done;
 op=jget(&q,ir,"operation");if(!jeq(&q,op,"create-sidecar"))goto done;
 kind=jget(&q,ir,"kind");
 suffix=jeq(&q,kind,"wal")?L"-wal":jeq(&q,kind,"shm")?L"-shm":L"-journal";
 if(!jnum(&p,jget(&p,root,"generation"),1,9007199254740991ULL,&generation)
    ||!jnum(&q,jget(&q,ir,"baseGeneration"),1,9007199254740990ULL,&base)
    ||!jnum(&q,jget(&q,ir,"targetGeneration"),2,9007199254740991ULL,&target))goto done;
 roles=jget(&p,root,"roles");role_name=jget(&q,ir,"role");
 for(role=p.v[roles].first;role!=0xffffffffu;role=p.v[role].next){
  DWORD current_role=jget(&p,role,"role");
  if(p.v[current_role].end-p.v[current_role].start==q.v[role_name].end-q.v[role_name].start
    &&!memcmp(p.s+p.v[current_role].start,q.s+q.v[role_name].start,p.v[current_role].end-p.v[current_role].start)){match=role;break;}
 }
 if(match==0xffffffffu||!jwide(&p,jget(&p,match,"databaseBasename"),database,(DWORD)LE_COUNT_OF(database))
   ||FAILED(StringCchCopyW(expected_basename,LE_COUNT_OF(expected_basename),database))
   ||FAILED(StringCchCatW(expected_basename,LE_COUNT_OF(expected_basename),suffix))
   ||!jwide(&q,jget(&q,ir,"basename"),actual_basename,(DWORD)LE_COUNT_OF(actual_basename))
   ||_wcsicmp(expected_basename,actual_basename)!=0)goto done;
 if(!logic_engine_win_anchor_path(namespace_root,&anchor))goto done;
 anchor_parent=anchor.parent;
 if(!jnative_identity(&p,jget(&p,root,"metadataRootIdentity"),&expected))goto done;
 root_handle=jopen_verified(anchor_parent,anchor.basename,&expected,1);
 if(root_handle==INVALID_HANDLE_VALUE||!jntfs_handle(root_handle))goto done;
 if(generation==target){
  int committed=0;
  for(side=p.v[jget(&p,match,"sidecars")].first;side!=0xffffffffu;side=p.v[side].next){
   if(jeq(&p,jget(&p,side,"kind"),jeq(&q,kind,"wal")?"wal":jeq(&q,kind,"shm")?"shm":"journal")
      &&jeq(&p,jget(&p,side,"state"),"active")
      &&jnum(&p,jget(&p,side,"generation"),1,generation,NULL))committed=1;
  }
  if(!committed)goto done;
  ok=1;
 }else if(generation==base){
  int active=0;
  for(side=p.v[jget(&p,match,"sidecars")].first;side!=0xffffffffu;side=p.v[side].next)
   if(jeq(&p,jget(&p,side,"kind"),jeq(&q,kind,"wal")?"wal":jeq(&q,kind,"shm")?"shm":"journal")
      &&jeq(&p,jget(&p,side,"state"),"active"))active=1;
  if(active)goto done;
  if(!jopen_role_parent(&p,match,root_handle,&parent))goto done;
  owns_parent=1;
  if(!jremove_uncommitted_sidecar(parent,actual_basename))goto done;
  ok=1;
 }else goto done;
 if(ok)ok=le_win_reconcile_manifest_namespace(manifest,manifest_length,namespace_root);
done:
 if(owns_parent&&parent!=INVALID_HANDLE_VALUE)CloseHandle(parent);
 if(root_handle!=INVALID_HANDLE_VALUE)CloseHandle(root_handle);
 if(anchor_parent!=INVALID_HANDLE_VALUE)CloseHandle(anchor_parent);
 if(anchor.basename)HeapFree(GetProcessHeap(),0,anchor.basename);
 if(p.v)HeapFree(GetProcessHeap(),0,p.v);
 if(q.v)HeapFree(GetProcessHeap(),0,q.v);
 if(!ok&&GetLastError()==ERROR_SUCCESS)SetLastError(ERROR_RECOVERY_FAILURE);
 return ok;
}

int le_win_validate_manifest(const unsigned char*b,DWORD n,void*c){(void)c;return jvalidate(b,n,0);}
int le_win_validate_intent(const unsigned char*b,DWORD n,void*c){(void)c;return jvalidate(b,n,1);}
#endif
