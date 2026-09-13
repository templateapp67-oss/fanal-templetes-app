import { test } from 'node:test';
import assert from 'node:assert/strict';
import { logPartnerFailure, safeGatewayFailure } from '../server/partnerErrorLog';
import { toGrowthPartnerLoginError } from '../src/lib/growthPartnerLogin';
import { safePartnerErrorMessage } from '../src/lib/partnerUiErrors';
import { isSessionExpiredError, resolveGrowthPartnerGate, toSafePartnerSectionError } from '../src/lib/growthPartner';
import { toSafeAuthError, toSafeReferralError } from '../src/onboarding/lib/flow';
import { isOnboardingPath, matchOnboardingRoute } from '../src/lib/router';

const secret = 'SQL select secret_token from private.users password=SUPERSECRET user@example.com';
test('partner and onboarding error boundaries never return raw database or rejected transport details', () => {
  for (const error of [new Error(secret), {message:secret,details:secret,hint:secret,code:'23505'}, new TypeError(`Failed to fetch ${secret}`)]) {
    for (const text of [safePartnerErrorMessage(error),toSafePartnerSectionError(error).message,toSafeAuthError(error).message,toSafeReferralError(error).message,safeGatewayFailure(error)]) {
      assert.ok(!text.includes('SUPERSECRET')); assert.ok(!text.includes('private.users')); assert.ok(!text.includes('user@example.com'));
    }
  }
  assert.match(safePartnerErrorMessage({status:401,message:secret}), /session expired/i);
  assert.match(toSafePartnerSectionError({message:'Failed to fetch'}).message, /connection/i);
  assert.match(toSafeReferralError({message:'Invalid or inactive referral code'}).message, /Invalid referral code/);
  assert.equal(isSessionExpiredError({message:'Sign in required'}), true);
  assert.match(safePartnerErrorMessage(toGrowthPartnerLoginError({code:'user_banned',message:secret})), /account is suspended/);
  assert.match(toSafeAuthError({code:'user_banned',message:secret}).message, /account is suspended/);
  const base = {userId:'user',loading:false,isMockMode:false,partnerRow:null,loadError:null};
  assert.equal(resolveGrowthPartnerGate(base), 'unauthorized', 'not found and unauthorized fail closed without account disclosure');
  assert.equal(resolveGrowthPartnerGate({...base,loadError:{code:'PGRST301'}}), 'session-expired');
  assert.equal(resolveGrowthPartnerGate({...base,loadError:new Error('Growth Partner account suspended')}), 'inactive');
});

test('server logs correlate technical failures without SQL, request secrets or log injection', () => {
  const logs: string[] = [];
  const id = logPartnerFailure('referral.prepare', {message:secret,code:'23505',status:503,details:secret,stack:secret}, line => logs.push(line));
  const entry = JSON.parse(logs[0]);
  assert.equal(entry.requestId,id); assert.equal(entry.code,'23505'); assert.equal(entry.status,503);
  assert.equal(entry.operation,'referral.prepare'); assert.match(entry.fingerprint,/^[a-f0-9]{16}$/);
  assert.ok(entry.at); assert.equal(entry.category,'database_or_service');
  for (const value of ['SUPERSECRET','private.users','user@example.com','select','password']) assert.ok(!logs.join('').includes(value));
  logPartnerFailure('attacker\n'+secret, {code:secret,message:secret}, line => logs.push(line));
  assert.equal(JSON.parse(logs[1]).operation,'unknown'); assert.equal(JSON.parse(logs[1]).code,'UNKNOWN');
  assert.doesNotThrow(() => logPartnerFailure('referral.capture',new Error(secret),() => {throw new Error('log sink down');}));
});

test('signup and register aliases resolve to the same onboarding signup route', () => {
  for (const path of ['/signup','/register','/register/','/REGISTER']) {
    assert.equal(isOnboardingPath(path),true); assert.equal(matchOnboardingRoute(path),'signup');
  }
  assert.equal(isOnboardingPath('/register-admin'),false);
});
