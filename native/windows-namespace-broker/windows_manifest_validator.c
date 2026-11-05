#ifdef _WIN32
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <stdint.h>
#include <stddef.h>
#include <string.h>
#include <stdlib.h>
#include <ctype.h>
#include "windows_manifest_validator.h"

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
static int jclaim_identity(JPARSER*p,DWORD id,DWORD*ids,DWORD*count,DWORD capacity){
 DWORD i;if(!jidentity(p,id)||*count>=capacity)return 0;
 for(i=0;i<*count;i++)if(jidentity_equal(p,id,ids[i]))return 0;
 ids[(*count)++]=id;return 1;
}
static int jidentity_equal(JPARSER*p,DWORD a,DWORD b){
 DWORD av=jget(p,a,"volumeSerial"),af=jget(p,a,"fileId"),bv=jget(p,b,"volumeSerial"),bf=jget(p,b,"fileId");
 return p->v[av].end-p->v[av].start==p->v[bv].end-p->v[bv].start
 &&p->v[af].end-p->v[af].start==p->v[bf].end-p->v[bf].start
 &&_strnicmp((const char*)p->s+p->v[av].start,(const char*)p->s+p->v[bv].start,p->v[av].end-p->v[av].start)==0
 &&_strnicmp((const char*)p->s+p->v[af].start,(const char*)p->s+p->v[bf].start,p->v[af].end-p->v[af].start)==0;
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
  DWORD pc,pi;unsigned active[3]={0,0,0};
  if(!jkeys(p,role,rolekeys,7)||!jrole_name(p,roleid)||!jeq(p,jget(p,role,"state"),"active")||!jcomponent(p,jget(p,role,"databaseBasename"))||!jidentity(p,jget(p,role,"databaseIdentity"))||p->v[parents].type!=J_ARRAY||p->v[components].type!=J_ARRAY||p->v[parents].count!=p->v[components].count||p->v[parents].count>256||p->v[sides].type!=J_ARRAY)return 0;
  for(i=0;i<32;i++)if(i<dbcount&&p->v[role_names[i]].end-p->v[role_names[i]].start==p->v[roleid].end-p->v[roleid].start&&!memcmp(p->s+p->v[role_names[i]].start,p->s+p->v[roleid].start,p->v[roleid].end-p->v[roleid].start))return 0;
  role_names[dbcount]=roleid;dbcount++;
  for(pc=p->v[components].first,pi=p->v[parents].first;pc!=0xffffffffu;pc=p->v[pc].next,pi=p->v[pi].next)if(!jcomponent(p,pc)||!jclaim_identity(p,pi,physical_ids,&physical_count,8192))return 0;
  dbid=jget(p,role,"databaseIdentity");if(!jclaim_identity(p,dbid,physical_ids,&physical_count,8192))return 0;
  for(i=0;i<p->v[sides].count;i++){side=(i==0?p->v[sides].first:p->v[side].next);if(!jkeys(p,side,sidekeys,4))return 0;
   kind=jeq(p,jget(p,side,"kind"),"wal")?"wal":jeq(p,jget(p,side,"kind"),"shm")?"shm":jeq(p,jget(p,side,"kind"),"journal")?"journal":NULL;
   if(!kind||!jclaim_identity(p,jget(p,side,"identity"),physical_ids,&physical_count,8192)||!jnum(p,jget(p,side,"generation"),1,gen,&sg))return 0;
   if(jeq(p,jget(p,side,"state"),"active")){unsigned ix=!strcmp(kind,"wal")?0:!strcmp(kind,"shm")?1:2;if(++active[ix]>1)return 0;}
   else if(!jeq(p,jget(p,side,"state"),"retired"))return 0;

  }
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
int le_win_validate_manifest(const unsigned char*b,DWORD n,void*c){(void)c;return jvalidate(b,n,0);}
int le_win_validate_intent(const unsigned char*b,DWORD n,void*c){(void)c;return jvalidate(b,n,1);}
#endif
