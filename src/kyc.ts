import type { Hono,Context } from 'hono';

export type KycEnv={DB:D1Database;AUTH_LIMITER:RateLimit};
type Member={id:string,email:string};
type Submission={id:string,user_id:string,revision:number,status:'pending'|'approved'|'rejected',identity_document_id:string,address_document_id:string,submitted_at:string,reviewed_at:string|null,expires_at:string|null,review_note:string|null};
const maxFile=5*1024*1024,chunkSize=256*1024,consentVersion='kyc-2026-11-17';
const stamp=(s:string)=>Date.parse(s.includes('T')?s:s.replace(' ','T')+'Z');
async function latest(db:D1Database,userId:string){return db.prepare('SELECT * FROM kyc_submissions WHERE user_id=? ORDER BY revision DESC LIMIT 1').bind(userId).first<Submission>()}
export async function kycStatus(db:D1Database,userId:string){
 const [submission,documents]=await Promise.all([latest(db,userId),db.prepare('SELECT d.id,d.kind,d.content_type,d.byte_size,d.created_at FROM kyc_upload_slots s JOIN kyc_documents d ON d.id=s.document_id WHERE s.user_id=? ORDER BY d.kind').bind(userId).all()]);
 const verified=submission?.status==='approved'&&!!submission.expires_at&&stamp(submission.expires_at)>Date.now();
 return {status:submission?.status==='approved'&&!verified?'expired':submission?.status||'not_started',verified,submissionId:submission?.id||null,revision:submission?.revision||0,submittedAt:submission?.submitted_at||null,reviewedAt:submission?.reviewed_at||null,expiresAt:submission?.expires_at||null,reviewNote:submission?.status==='rejected'?submission.review_note:null,documents:documents.results,consentVersion,maxFileBytes:maxFile,withdrawalRequestsEnabled:verified,payoutExecutionEnabled:false};
}
async function readUpload(request:Request){
 if(Number(request.headers.get('content-length')||0)>maxFile+16384)throw Error('FILE_TOO_LARGE');
 if(!request.headers.get('content-type')?.startsWith('multipart/form-data;'))throw Error('MULTIPART_REQUIRED');
 const reader=request.body?.getReader();if(!reader)throw Error('DOCUMENT_REQUIRED');
 const chunks:Uint8Array[]=[];let length=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>maxFile+16384){await reader.cancel();throw Error('FILE_TOO_LARGE')}chunks.push(value)}}finally{reader.releaseLock()}
 const body=new Uint8Array(length);let offset=0;for(const chunk of chunks){body.set(chunk,offset);offset+=chunk.length}
 const form=await new Response(body,{headers:{'content-type':request.headers.get('content-type')!}}).formData();
 const fields=[...form.keys()];if(fields.length!==1||fields[0]!=='document')throw Error('ONE_DOCUMENT_REQUIRED');
 const file=form.get('document');if(file&&typeof file!=='string'&&file.size>maxFile)throw Error('FILE_TOO_LARGE');if(!file||typeof file==='string'||file.size<32)throw Error('INVALID_DOCUMENT_SIZE');
 const bytes=new Uint8Array(await file.arrayBuffer());
 const png=[137,80,78,71,13,10,26,10].every((v,i)=>bytes[i]===v),jpeg=bytes[0]===255&&bytes[1]===216&&bytes[2]===255,pdf=new TextDecoder().decode(bytes.slice(0,5))==='%PDF-';
 const type=png?'image/png':jpeg?'image/jpeg':pdf?'application/pdf':null;
 if(!type||file.type!==type)throw Error('UNSUPPORTED_DOCUMENT');
 if(pdf&&/\/(JavaScript|JS|OpenAction|AA|Launch|EmbeddedFile|RichMedia)\b/i.test(new TextDecoder('latin1').decode(bytes)))throw Error('ACTIVE_PDF_NOT_ALLOWED');
 return {bytes,type};
}
export function registerKycRoutes<B extends KycEnv>(app:Hono<{Bindings:B}>,authenticate:(c:Context<{Bindings:B}>)=>Promise<Member|null>){
 const sameOrigin=(c:Context<{Bindings:B}>)=>c.req.header('origin')===new URL(c.req.url).origin;
 const reviewer=async(c:Context<{Bindings:B}>)=>{const user=await authenticate(c);if(!user)return null;return await c.env.DB.prepare('SELECT user_id FROM kyc_reviewers WHERE user_id=? AND enabled=1').bind(user.id).first()?user:null};
 app.get('/api/investor/kyc',async c=>{const user=await authenticate(c);if(!user)return c.json({error:'Unauthorized'},401);return c.json(await kycStatus(c.env.DB,user.id))});
 app.post('/api/investor/kyc/documents/:kind',async c=>{
  const user=await authenticate(c);if(!user)return c.json({error:'Unauthorized'},401);
  if(!sameOrigin(c))return c.json({error:'A same-origin upload is required'},403);
  const kind=c.req.param('kind');if(!['identity','address'].includes(kind))return c.json({error:'Choose an identity document or proof of address'},400);
  const {success}=await c.env.AUTH_LIMITER.limit({key:'kyc-upload:'+user.id});if(!success)return c.json({error:'Please wait before uploading another document'},429);
  const state=await kycStatus(c.env.DB,user.id);if(state.status==='pending'||state.verified)return c.json({error:'Your submitted documents are locked during review or verification'},409);
  const count=await c.env.DB.prepare("SELECT COUNT(*) AS n FROM kyc_documents WHERE user_id=? AND created_at>datetime('now','-1 day')").bind(user.id).first<{n:number}>();
  if((count?.n||0)>=10)return c.json({error:'Daily document upload limit reached. Please contact account support.'},429);
  let upload;try{upload=await readUpload(c.req.raw)}catch(error){const code=error instanceof Error?error.message:'INVALID_DOCUMENT';return c.json({error:code==='FILE_TOO_LARGE'?'Each document must be 5 MB or smaller':'Use a clear JPG or PNG image, or a PDF without active content for proof of address.',code},code==='FILE_TOO_LARGE'?413:400)}
  if(kind==='identity'&&upload.type==='application/pdf')return c.json({error:'Upload your identity document as a JPG or PNG photograph'},400);
  const id=crypto.randomUUID(),hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',upload.bytes)),b=>b.toString(16).padStart(2,'0')).join('');
  const writes=[c.env.DB.prepare('INSERT INTO kyc_documents(id,user_id,kind,content_type,byte_size,sha256,created_at) VALUES(?,?,?,?,?,?,?)').bind(id,user.id,kind,upload.type,upload.bytes.length,hash,new Date().toISOString())];
  for(let offset=0,part=0;offset<upload.bytes.length;offset+=chunkSize,part++)writes.push(c.env.DB.prepare('INSERT INTO kyc_document_chunks(document_id,part,body) VALUES(?,?,?)').bind(id,part,upload.bytes.slice(offset,offset+chunkSize).buffer));
  writes.push(c.env.DB.prepare('INSERT INTO kyc_upload_slots(user_id,kind,document_id) VALUES(?,?,?) ON CONFLICT(user_id,kind) DO UPDATE SET document_id=excluded.document_id').bind(user.id,kind,id),c.env.DB.prepare("INSERT INTO kyc_events(id,user_id,actor_id,document_id,action) VALUES(?,?,?,?,'uploaded')").bind(crypto.randomUUID(),user.id,user.id,id));
  try{await c.env.DB.batch(writes)}catch(error){if(String(error).includes('KYC_REVIEW_LOCKED'))return c.json({error:'Documents were submitted while this upload was in progress. Refresh your verification status.'},409);if(String(error).includes('KYC_STORAGE_LIMIT'))return c.json({error:'Your document storage limit has been reached. Contact account support before uploading more files.'},409);throw error}
  return c.json({document:{id,kind,contentType:upload.type,size:upload.bytes.length},kyc:await kycStatus(c.env.DB,user.id)},201);
 });
 app.post('/api/investor/kyc/submit',async c=>{
  const user=await authenticate(c);if(!user)return c.json({error:'Unauthorized'},401);if(!sameOrigin(c))return c.json({error:'Same-origin request required'},403);
  const {success}=await c.env.AUTH_LIMITER.limit({key:'kyc-submit:'+user.id});if(!success)return c.json({error:'Please wait before submitting again'},429);
  const body=await c.req.json().catch(()=>null);if(body?.consent!==true||body?.consentVersion!==consentVersion)return c.json({error:'Confirm permission to use your documents for account verification'},400);
  const state=await kycStatus(c.env.DB,user.id);if(state.status==='pending')return c.json(state);if(state.verified)return c.json(state);
  const docs=state.documents as {id:string,kind:string,created_at:string}[],identity=docs.find(d=>d.kind==='identity'),address=docs.find(d=>d.kind==='address');
  if(!identity||!address)return c.json({error:'Upload both your ID photograph and proof of address'},400);
  if(state.status==='expired'&&[identity,address].some(d=>stamp(d.created_at)<=stamp(state.expiresAt!)))return c.json({error:'Upload new identity and address documents to renew verification'},400);
  const id=crypto.randomUUID();
  try{await c.env.DB.prepare('INSERT INTO kyc_submissions(id,user_id,revision,identity_document_id,address_document_id,consent_version) VALUES(?,?,?,?,?,?)').bind(id,user.id,state.revision+1,identity.id,address.id,consentVersion).run()}catch(error){if(/KYC_REVIEW_LOCKED|UNIQUE constraint/.test(String(error)))return c.json(await kycStatus(c.env.DB,user.id));throw error}
  return c.json(await kycStatus(c.env.DB,user.id),202);
 });
 app.get('/api/admin/kyc',async c=>{
  const admin=await reviewer(c);if(!admin)return c.json({error:'Reviewer access required'},403);
  const rows=await c.env.DB.prepare("SELECT k.id,k.user_id,k.revision,k.submitted_at,k.identity_document_id,k.address_document_id,p.display_name FROM kyc_submissions k JOIN account_profiles p ON p.user_id=k.user_id WHERE k.status='pending' AND k.user_id<>? ORDER BY k.submitted_at LIMIT 50").bind(admin.id).all();return c.json({rows:rows.results});
 });
 app.get('/api/admin/kyc/:submission/documents/:kind',async c=>{
  const admin=await reviewer(c);if(!admin)return c.json({error:'Reviewer access required'},403);
  const submission=await c.env.DB.prepare("SELECT * FROM kyc_submissions WHERE id=? AND status='pending' AND user_id<>?").bind(c.req.param('submission'),admin.id).first<Submission>();if(!submission)return c.json({error:'Review not found'},404);
  const kind=c.req.param('kind');if(!['identity','address'].includes(kind))return c.json({error:'Document not found'},404);const id=kind==='identity'?submission.identity_document_id:submission.address_document_id;
  const document=await c.env.DB.prepare('SELECT content_type,byte_size FROM kyc_documents WHERE id=? AND user_id=?').bind(id,submission.user_id).first<{content_type:string,byte_size:number}>();if(!document)return c.json({error:'Document not found'},404);
  const chunks=await c.env.DB.prepare('SELECT body FROM kyc_document_chunks WHERE document_id=? ORDER BY part').bind(id).all<{body:number[]|ArrayBuffer}>();const bytes=new Uint8Array(document.byte_size);let offset=0;
  for(const chunk of chunks.results){const value=new Uint8Array(chunk.body);bytes.set(value,offset);offset+=value.length}if(offset!==document.byte_size)throw Error('Incomplete document storage');
  await c.env.DB.prepare("INSERT INTO kyc_events(id,user_id,actor_id,submission_id,document_id,action) VALUES(?,?,?,?,?,'document_accessed')").bind(crypto.randomUUID(),submission.user_id,admin.id,submission.id,id).run();
  c.header('Content-Type',document.content_type);c.header('Content-Disposition','attachment; filename="'+kind+(document.content_type==='application/pdf'?'.pdf':document.content_type==='image/png'?'.png':'.jpg')+'"');c.header('Content-Security-Policy',"sandbox; default-src 'none'");c.header('Cross-Origin-Resource-Policy','same-origin');return c.body(bytes);
 });
 app.post('/api/admin/kyc/:submission/decision',async c=>{
  const admin=await reviewer(c);if(!admin)return c.json({error:'Reviewer access required'},403);if(!sameOrigin(c))return c.json({error:'Same-origin request required'},403);
  const {success}=await c.env.AUTH_LIMITER.limit({key:'kyc-review:'+admin.id});if(!success)return c.json({error:'Please wait before another decision'},429);
  const body=await c.req.json().catch(()=>null),note=typeof body?.note==='string'?body.note.trim():'';
  if(!['approved','rejected'].includes(body?.decision)||!Number.isInteger(body?.revision)||note.length<10||note.length>500)return c.json({error:'Choose a decision and provide a 10–500 character review note'},400);
  if(body.decision==='approved'&&(body.identityMatched!==true||body.addressMatched!==true||body.validityChecked!==true))return c.json({error:'Complete all identity, address and document-validity checks'},400);
  try{const result=await c.env.DB.prepare("UPDATE kyc_submissions SET status=?,reviewer_id=?,reviewed_at=?,expires_at=?,review_note=?,identity_matched=?,address_matched=?,validity_checked=? WHERE id=? AND revision=? AND status='pending' AND user_id<>?").bind(body.decision,admin.id,new Date().toISOString(),body.decision==='approved'?new Date(Date.now()+365*86400000).toISOString():null,note,body.identityMatched===true?1:0,body.addressMatched===true?1:0,body.validityChecked===true?1:0,c.req.param('submission'),body.revision,admin.id).run();if(!result.meta.changes)return c.json({error:'This review changed or is unavailable. Refresh the queue.'},409)}catch(error){if(String(error).includes('KYC_'))return c.json({error:'Open both documents and complete the evidence review before deciding'},409);throw error}
  return c.json({ok:true,status:body.decision});
 });
 app.get('/api/investor/withdrawals',async c=>{
  const user=await authenticate(c);if(!user)return c.json({error:'Unauthorized'},401);const identity=await kycStatus(c.env.DB,user.id);
  const [balances,requests]=await c.env.DB.batch([c.env.DB.prepare("SELECT a.asset,MAX(0,SUM(a.amount_minor)-COALESCE((SELECT SUM(w.amount_minor) FROM withdrawal_requests w WHERE w.user_id=? AND w.asset=a.asset AND w.status IN ('pending_review','approved')),0)) AS available_minor FROM ada_balances a WHERE a.user_id=? AND a.bucket IN ('funding','realized') GROUP BY a.asset").bind(user.id,user.id),c.env.DB.prepare('SELECT id,asset,amount_minor,destination_network,status,requested_at FROM withdrawal_requests WHERE user_id=? ORDER BY requested_at DESC LIMIT 20').bind(user.id)]);
  return c.json({identityVerified:identity.verified,requestsEnabled:identity.verified,payoutExecutionEnabled:false,balances:balances.results,requests:requests.results});
 });
 app.post('/api/investor/withdrawals',async c=>{
  const user=await authenticate(c);if(!user)return c.json({error:'Unauthorized'},401);if(!sameOrigin(c))return c.json({error:'Same-origin request required'},403);
  const state=await kycStatus(c.env.DB,user.id);if(!state.verified)return c.json({error:'Verify your identity before requesting a withdrawal',code:'KYC_REQUIRED'},403);
  const {success}=await c.env.AUTH_LIMITER.limit({key:'withdrawal:'+user.id});if(!success)return c.json({error:'Please wait before another request'},429);
  const body=await c.req.json().catch(()=>null),key=c.req.header('idempotency-key')||'',address=String(body?.destinationAddress||'').toLowerCase();
  if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(key)||!['USDC','USDT'].includes(body?.asset)||!Number.isSafeInteger(body?.amountMinor)||body.amountMinor<=0||!/^0x[a-f0-9]{40}$/.test(address)||/^0x0{40}$/.test(address))return c.json({error:'Enter a valid Celo wallet, stablecoin and exact token amount'},400);
  const find=()=>c.env.DB.prepare('SELECT id,asset,amount_minor,destination_address,status FROM withdrawal_requests WHERE user_id=? AND idempotency_key=?').bind(user.id,key).first<{id:string,asset:string,amount_minor:number,destination_address:string,status:string}>();
  const present=async()=>{const row=await find();if(!row)return null;return row.asset===body.asset&&row.amount_minor===body.amountMinor&&row.destination_address===address?c.json({requestId:row.id,status:row.status,payoutExecutionEnabled:false}):c.json({error:'This request key was already used for a different withdrawal'},409)};
  const replay=await present();if(replay)return replay;
  const id=crypto.randomUUID();
  try{const inserted=await c.env.DB.prepare("INSERT INTO withdrawal_requests(id,user_id,asset,amount_minor,destination_network,destination_address,status,idempotency_key) SELECT ?,?,?,?,'celo',?,'pending_review',? WHERE ?<=COALESCE((SELECT SUM(amount_minor) FROM ada_balances WHERE user_id=? AND asset=? AND bucket IN ('funding','realized')),0)-COALESCE((SELECT SUM(amount_minor) FROM withdrawal_requests WHERE user_id=? AND asset=? AND status IN ('pending_review','approved')),0)").bind(id,user.id,body.asset,body.amountMinor,address,key,body.amountMinor,user.id,body.asset,user.id,body.asset).run();if(!inserted.meta.changes)return c.json({error:'The requested amount exceeds your available settled balance'},409)}catch(error){const replay=await present();if(replay)return replay;if(String(error).includes('IDENTITY_VERIFICATION_REQUIRED'))return c.json({error:'Identity verification is required'},403);throw error}
  return c.json({requestId:id,status:'pending_review',payoutExecutionEnabled:false},201);
 });
}
