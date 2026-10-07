import test from "node:test";
import assert from "node:assert/strict";
import { scanGmailInBrowser } from "./browserScan.ts";
import { decodeBase64Url } from "./parse.ts";
import { GmailApiError } from "./client.ts";
import { safeNextPath } from "../supabase/safeNextPath.ts";
import { readFileSync } from "node:fs";
import { requestGmailBrowserAccessToken } from "./browserOAuth.ts";
import { mergeReviewMessages } from "./reviewMessages.ts";

const message = (id: string, snippet = "We have received your application.") => ({
  id, threadId: `t${id}`, internalDate: "1791331200000", snippet,
  payload: {headers: [{name: "From", value: "Acme Careers <careers@acme.com>"},
    {name: "Subject", value: "Your application to Acme Corp"}]},
});

test("browser decoding preserves UTF-8 without Node Buffer", () => {
  const original = globalThis.Buffer;
  const encoded = original.from("Résumé – interview").toString("base64url");
  try {
    // @ts-expect-error Deliberately emulate the browser's absent Node global.
    globalThis.Buffer = undefined;
    assert.equal(decodeBase64Url(encoded), "Résumé – interview");
    assert.equal(decodeBase64Url("%%%"), "");
  } finally { globalThis.Buffer = original; }
});

test("auth destinations cannot escape via slashes, backslashes or controls", () => {
  for (const value of [null, "https://evil.invalid", "//evil.invalid", "/\\evil.invalid", "/\n/evil.invalid"]) {
    assert.equal(safeNextPath(value), "/");
  }
  assert.equal(safeNextPath("/applications?status=Offer#details"), "/applications?status=Offer#details");
});

test("zero matches complete successfully", async t => {
  t.mock.method(globalThis, "fetch", async () => Response.json({}));
  const result = await scanGmailInBrowser({accessToken: "test-only", window: "30d"});
  assert.equal(result.messagesListed, 0);
  assert.equal(result.messagesFailed, 0);
  assert.deepEqual(result.candidateMessages, []);
});

test("overlapping Gmail pages fetch each message once and preserve traceability", async t => {
  const fetched: string[] = [];
  t.mock.method(globalThis, "fetch", async (input: URL, init: RequestInit) => {
    assert.ok(init.signal, "every request is bounded");
    const url = new URL(String(input));
    const id = url.pathname.split("/").at(-1)!;
    if (id === "messages") return Response.json(url.searchParams.has("pageToken")
      ? {messages: [{id:"1",threadId:"t1"},{id:"2",threadId:"t2"}]}
      : {messages: [{id:"1",threadId:"t1"}], nextPageToken:"next"});
    fetched.push(id);
    assert.equal(url.searchParams.get("format"), "metadata");
    return Response.json(message(id));
  });
  const result = await scanGmailInBrowser({accessToken:"test-only", window:"30d"});
  assert.deepEqual(fetched.sort(), ["1","2"]);
  assert.equal(result.messagesListed, 2);
  assert.deepEqual(result.candidateMessages.map(m => m.gmailMessageId).sort(), ["1","2"]);
});

test("partial metadata failures are reported, while all failures cannot claim zero success", async t => {
  let failAll = false;
  t.mock.method(globalThis,"fetch",async (input:URL) => {
    const id = new URL(String(input)).pathname.split("/").at(-1)!;
    if (id === "messages") return Response.json({messages:[{id:"1",threadId:"t1"},{id:"2",threadId:"t2"}]});
    return id === "2" || failAll ? new Response("private payload",{status:404}) : Response.json(message(id));
  });
  const result = await scanGmailInBrowser({accessToken:"test-only",window:"30d"});
  assert.equal(result.messagesFailed,1);
  assert.equal(result.candidateMessages.length,1);
  failAll = true;
  await assert.rejects(scanGmailInBrowser({accessToken:"test-only",window:"30d"}), GmailApiError);
});

test("expired tokens stop the queue and never expose vendor payloads",async t => {
  let reads = 0;
  t.mock.method(globalThis,"fetch",async (input:URL) => {
    const id = new URL(String(input)).pathname.split("/").at(-1)!;
    if(id === "messages") return Response.json({messages:Array.from({length:20},(_,i)=>({id:String(i),threadId:`t${i}`}))});
    reads++;
    return new Response("test-only token and email body",{status:401});
  });
  await assert.rejects(scanGmailInBrowser({accessToken:"test-only",window:"30d"}), (error:unknown) => {
    assert.ok(error instanceof GmailApiError);
    assert.equal(error.kind,"unauthorized");
    assert.ok(!error.message.includes("test-only"));
    return true;
  });
  assert.ok(reads <= 5);
});

test("body escalation actually reads lifecycle evidence in a browser", async t => {
  t.mock.method(globalThis,"fetch",async (input:URL) => {
    const url=new URL(String(input));
    if(url.pathname.endsWith("/messages"))return Response.json({messages:[{id:"1",threadId:"t1"}]});
    const email=message("1","Regarding your application");
    email.payload.headers[0].value="Recruiting <careers@greenhouse.io>";
    if(url.searchParams.get("format")==="full")return Response.json({...email,payload:{...email.payload,mimeType:"text/plain",body:{data:btoa("Thank you for applying to the Backend Engineer role at Acme Corp. We have received your application.")}}});
    return Response.json(email);
  });
  const result=await scanGmailInBrowser({accessToken:"test-only",window:"30d"});
  assert.equal(result.bodyEscalated,1);
  assert.equal(result.bodyResolved,1);
  assert.equal(result.candidateMessages[0].status,"Applied");
});

test("repeated pagination and malformed lists fail recoverably",async t=>{
  t.mock.method(globalThis,"fetch",async()=>Response.json({messages:[{id:"1",threadId:"t1"}],nextPageToken:"same"}));
  await assert.rejects(scanGmailInBrowser({accessToken:"test-only",window:"30d"}),/repeated pages/);
  t.mock.method(globalThis,"fetch",async()=>Response.json({messages:[{}]}));
  await assert.rejects(scanGmailInBrowser({accessToken:"test-only",window:"30d"}),/invalid message list/);
});

for (const status of [429,503]) test(`isolated exhausted HTTP ${status} retries do not abandon the remaining queue`,async t=>{
  let reads=0;
  t.mock.method(globalThis,"fetch",async(input:URL)=>{
    if(new URL(String(input)).pathname.endsWith("/messages"))return Response.json({messages:Array.from({length:40},(_,i)=>({id:String(i),threadId:`t${i}`}))});
    reads++;
    const id=new URL(String(input)).pathname.split('/').at(-1)!;
    return id==='0'?new Response("vendor payload",{status}):Response.json(message(id));
  });
  const result=await scanGmailInBrowser({accessToken:"test-only",window:"90d"});
  assert.equal(reads,42,"one failed message receives bounded retries; all other messages are attempted");
  assert.equal(result.messagesProcessed,40);
  assert.equal(result.metadataFailed,1);
  assert.equal(result.candidateMessages.length,39);
  assert.equal(result.reviewMessages.length,0);
});

test("body escalation follows Gmail order despite slower metadata and preserves deferred unknowns",async t=>{
  const bodies:string[]=[];
  t.mock.method(globalThis,'fetch',async(input:URL)=>{
    const url=new URL(String(input));
    if(url.pathname.endsWith('/messages'))return Response.json({messages:Array.from({length:42},(_,i)=>({id:String(i),threadId:`t${i}`}))});
    const id=url.pathname.split('/').at(-1)!;
    const email=message(id,'Regarding your application');
    email.payload.headers[0].value='Recruiting <careers@greenhouse.io>';
    if(url.searchParams.get('format')==='full')bodies.push(id);
    else if(id==='0')await new Promise(resolve=>setTimeout(resolve,30));
    return Response.json(email);
  });
  const result=await scanGmailInBrowser({accessToken:'test-only',window:'60d'});
  assert.deepEqual(bodies,[...Array(40)].map((_,i)=>String(i)));
  assert.equal(result.ambiguousCount,42);
  assert.equal(result.reviewMessages.length,42);
  assert.equal(result.candidateMessages.length,0,'unknown status must not become an invented application');
  assert.equal(result.reviewMessages[0].gmailMessageId,'0');
  assert.ok(!JSON.stringify(result.reviewMessages).includes('Regarding your application'),'raw subjects/bodies are not persisted');
  assert.equal(mergeReviewMessages(result.reviewMessages,[],['0']).length,41);
  assert.equal(mergeReviewMessages(result.reviewMessages,[],[]).length,42,'shorter/partial scans retain prior review evidence');
});

test("large-window ATS lifecycle fixtures retain distinct employers and roles",async t=>{
  const emails=[
    {...message('alpha'),snippet:'Thank you for applying to the Backend Engineer role at Alpha Corp. We have received your application.'},
    {...message('alpha-other'),snippet:'Thank you for applying to the Data Analyst role at Alpha Corp. We have received your application.'},
    {...message('beta'),snippet:'Thank you for applying to the Backend Engineer role at Beta Corp. We have received your application.'},
    {...message('interview'),snippet:'We would like to invite you to an interview for your application.'},
    {...message('reject'),snippet:'Unfortunately we will not be moving forward with your application.'},
  ];
  for(const email of emails){email.payload.headers[0].value='Recruiting <notifications@greenhouse.io>';email.payload.headers[1].value='Your application update';email.threadId='shared-ats-thread';}
  t.mock.method(globalThis,'fetch',async(input:URL)=>{
    const id=new URL(String(input)).pathname.split('/').at(-1)!;
    return Response.json(id==='messages'?{messages:emails.map(({id,threadId})=>({id,threadId}))}:emails.find(m=>m.id===id));
  });
  const result=await scanGmailInBrowser({accessToken:'test-only',window:'90d'});
  assert.equal(result.candidateMessages.length,5);
  assert.equal(result.candidateMessages.find(m=>m.gmailMessageId==='interview')?.status,'Interview');
  assert.equal(result.candidateMessages.find(m=>m.gmailMessageId==='reject')?.status,'Rejected');
});

test("analytics starts in the background only for complete scans and binds the original user",()=>{
  const ui=readFileSync(new URL('../../app/dashboard/components/GmailScanModule.tsx',import.meta.url),'utf8');
  assert.match(ui,/void \(async \(\) =>/);
  assert.match(ui,/if \(result\.messagesFailed.*result\.truncated\) return/);
  assert.match(ui,/expectedUserId: user\.id/);
  assert.match(ui,/signal: AbortSignal\.timeout\(8_000\)/);
});

test("browser OAuth cancellation is recoverable and a subsequent authorization returns a token",async()=>{
  const previous=Object.getOwnPropertyDescriptor(globalThis,"window");
  const clientId=process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
  let cancelled=true;
  process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID="test-public-client-id";
  Object.defineProperty(globalThis,"window",{configurable:true,value:{google:{accounts:{oauth2:{initTokenClient(config:{scope:string;callback:(response:unknown)=>void;error_callback:(error:{type:string})=>void}){
    assert.ok(config.scope.endsWith("gmail.readonly"));
    return {requestAccessToken(){if(cancelled)config.error_callback({type:"popup_closed"});else config.callback({access_token:"test-only",expires_in:300});}};
  }}}}}});
  try {
    await assert.rejects(requestGmailBrowserAccessToken(),/cancelled/);
    cancelled=false;
    const token=await requestGmailBrowserAccessToken();
    assert.equal(token.accessToken,"test-only");assert.equal(token.expiresIn,300);
  } finally {
    if(previous)Object.defineProperty(globalThis,"window",previous);else Reflect.deleteProperty(globalThis,"window");
    if(clientId===undefined)delete process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;else process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID=clientId;
  }
});
