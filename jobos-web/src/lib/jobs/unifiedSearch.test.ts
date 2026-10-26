import test from "node:test";
import assert from "node:assert/strict";
import { buildSearchVocabulary, publicJobQuery, searchSuggestions } from "./searchSuggestions.ts";
import { getHimalayasJob, himalayasPath, normalizeHimalayas, readHimalayasFeed } from "./himalayas.ts";
import { matchesDateWindow, matchesIndiaLocation, matchesJobQuery } from "./browsing.ts";
import { isActiveRecommendation, rankJob } from "./ranking.ts";
import { publicCatalogForDisplay } from "./catalogPolicy.ts";
import { EMPTY_PROFILE } from "./types.ts";

const now = new Date().toISOString(), nowMs = Date.parse(now);
const raw = () => ({ title: "Sales Executive", companyName: "Fixture Employer", companySlug: "fixture-employer", guid: "https://himalayas.app/companies/fixture-employer/jobs/sales-executive", applicationLink: "https://himalayas.app/companies/fixture-employer/jobs/sales-executive?utm_source=api", locationRestrictions: ["India"], timezoneRestrictions: [5.5], pubDate: Math.floor(nowMs / 1000) - 3600, expiryDate: Math.floor(nowMs / 1000) + 86400, description: "<p>SQL and Excel required. Two years of experience.</p>", employmentType: "Full Time", currency: "INR", minSalary: 25000, maxSalary: 35000, salaryPeriod: "monthly" });

test("role, skill and company suggestions cover Data and Sales without claiming hiring", () => {
  const vocabulary = buildSearchVocabulary([{title:"Analyst Intern",company:"Example Employer",skills:["Power BI"]}]);
  const data = searchSuggestions(vocabulary, "data").map(item => item.value);
  for (const role of ["Data Analyst", "Data Scientist", "Data Engineer", "Data Entry Operator"]) assert.ok(data.includes(role));
  assert.ok(searchSuggestions(vocabulary,"sales").some(item => item.value === "Sales Executive"));
  assert.equal(searchSuggestions(vocabulary,"sales")[0].value,"Sales Executive");
  assert.equal(searchSuggestions(vocabulary,"Power")[0].kind,"Skill");
  assert.equal(searchSuggestions(vocabulary,"Example")[0].kind,"Company");
  assert.equal(searchSuggestions(vocabulary,"unknown invented keyword").length,0);
  for(const value of ["person@example.com","https://example.com","1234567890"]) assert.equal(publicJobQuery(value),"");
});

test("public feed preserves apply attribution and update provenance, supporting the existing resume matcher", () => {
  const job = normalizeHimalayas(raw(), now)!;
  assert.ok(job);
  assert.equal(job.applicationUrl,raw().applicationLink);
  assert.equal(job.sourceUrl,raw().guid);
  assert.equal(job.postedAt,null);
  assert.equal(job.releasedAt,null);
  assert.ok(job.updatedAt);
  assert.equal(job.salary?.period,"month");
  assert.ok(job.id.length <= 150, "uses the existing tracker ID constraint without a schema change");
  assert.equal(himalayasPath(job.id,job.sourceUrl),new URL(raw().guid).pathname);
  assert.equal(himalayasPath(job.id,"https://himalayas.app/companies/other/jobs/other"),null);
  assert.ok(job.skills.includes("SQL"));
  assert.ok(rankJob(job,{...EMPTY_PROFILE, roles:["Sales Executive"], skills:["SQL","Excel"]},undefined,nowMs).fit.score > 0);
  assert.equal(matchesDateWindow(job,"1",nowMs),true);
  assert.equal(matchesIndiaLocation(job,"Kolkata, West Bengal"),true);
  assert.equal(matchesIndiaLocation(job,"Dhanbad, Jharkhand"),true);
  assert.equal(matchesIndiaLocation(job,"London"),false);
  assert.equal(matchesIndiaLocation({...job,remoteIndiaEligible:false},"Kolkata, West Bengal"),false);
  const cityRole=normalizeHimalayas({...raw(),title:"Executive Account Manager, Hyderabad"},now)!;
  assert.equal(cityRole.remoteIndiaEligible,false);
  assert.equal(matchesIndiaLocation(cityRole,"Kolkata, West Bengal"),false);
  assert.equal(matchesIndiaLocation(cityRole,"Hyderabad, Telangana"),true);
  const unrelated=normalizeHimalayas({...raw(),title:"VP, Business Development",description:"Support the sales team and executive presentations. SQL required."},now)!;
  assert.equal(matchesJobQuery(unrelated,"Sales Executive"),false,"a selected role must not match incidental words in the description");
  assert.equal(matchesJobQuery(unrelated,"SQL"),true,"explicit technical skill search still reads requirements");
});

test("worldwide-only, foreign, expired and unsafe public records never become India listings", () => {
  for(const patch of [{locationRestrictions:[]},{locationRestrictions:["United States"]},{timezoneRestrictions:[-5]},{timezoneRestrictions:null},{expiryDate:1},{expiryDate:1e100},{guid:"https://evil.example/companies/a/jobs/b"},{guid:"https://himalayas.app/companies/a/jobs/../../admin"},{applicationLink:"javascript:alert(1)"}]) assert.equal(normalizeHimalayas({...raw(),...patch},now),null);
  for(const id of ["himalayas:india:a","himalayas:india:"+Buffer.from("/../../secret").toString("base64url"),"greenhouse:a:b"]) assert.equal(himalayasPath(id),null);
});

test("daily source checks have a bounded distinct window without relaxing employer freshness", () => {
  const job=normalizeHimalayas(raw(),now)!;
  const daily={...job,fetchedAt:new Date(nowMs-60*60_000).toISOString()};
  assert.equal(isActiveRecommendation(daily,nowMs),true);
  assert.equal(isActiveRecommendation({...daily,source:"Greenhouse"},nowMs),false);
  assert.equal(isActiveRecommendation({...daily,fetchedAt:new Date(nowMs-25*60*60_000).toISOString()},nowMs),false);
  const catalog={jobs:[daily,{...daily,id:"employer",source:"Greenhouse"}],checkedAt:now,warnings:[]};
  assert.equal(publicCatalogForDisplay(catalog,nowMs).jobs.length,1);
  const dailyCatalog={jobs:[daily],checkedAt:daily.fetchedAt,warnings:[],sources:[{provider:"Himalayas",board:"India remote",status:"ok" as const,jobs:1,checkedAt:daily.fetchedAt}]};
  assert.deepEqual(publicCatalogForDisplay(dailyCatalog,nowMs).warnings,[],"a healthy daily snapshot must not claim employer refresh trouble");
});

test("provider pagination ignores estimated counts, follows short pages and deduplicates source IDs", async () => {
  const original=globalThis.fetch, pages:number[]=[];
  globalThis.fetch=async(url) => {
    const parsed=new URL(String(url)),page=Number(parsed.searchParams.get("page")); pages.push(page);
    assert.equal(parsed.hostname,"himalayas.app"); assert.equal(parsed.searchParams.get("country"),"IN"); assert.equal(parsed.searchParams.get("q"),"Sales Executive");
    return Response.json({totalCount:999999,jobs:page<3?[raw()]:[]});
  };
  try {const feed=await readHimalayasFeed("Sales Executive"); assert.deepEqual(pages,[1,2,3]); assert.equal(feed.jobs.length,1); assert.equal(feed.limited,false);}
  finally{globalThis.fetch=original;}
});

test("bounded source slices are labelled and provider outages never look like empty successful feeds", async () => {
  const original=globalThis.fetch;
  globalThis.fetch=async()=>Response.json({jobs:[raw()]});
  try {assert.equal((await readHimalayasFeed()).limited,true);
    globalThis.fetch=async()=>new Response(null,{status:429}); await assert.rejects(readHimalayasFeed(),/unavailable/);
    globalThis.fetch=async()=>Response.json({error:"upstream changed"}); await assert.rejects(readHimalayasFeed(),/incomplete/);
  } finally{globalThis.fetch=original;}
});

test("detail checks use only the fixed provider endpoint and distinguish closure from provider failure", async () => {
  const original=globalThis.fetch,job=normalizeHimalayas(raw(),now)!;
  globalThis.fetch=async(url)=>{assert.equal(String(url),"https://himalayas.app/jobs/api"+new URL(raw().guid).pathname);return Response.json({job:raw()});};
  try {assert.equal((await getHimalayasJob(job.id,job.sourceUrl))?.id,job.id);
    await assert.rejects(getHimalayasJob(job.id,"https://evil.example/companies/a/jobs/b"),/identity/);
    globalThis.fetch=async()=>new Response(null,{status:410}); assert.equal(await getHimalayasJob(job.id,job.sourceUrl),null);
    globalThis.fetch=async()=>new Response(null,{status:503}); await assert.rejects(getHimalayasJob(job.id,job.sourceUrl),/unavailable/);
    globalThis.fetch=async()=>Response.json({}); await assert.rejects(getHimalayasJob(job.id,job.sourceUrl),/verified/);
  }finally{globalThis.fetch=original;}
});
