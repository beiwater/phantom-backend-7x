import assert from 'node:assert/strict';
import { db } from '../server/db/database.ts';
import { storyLoader } from '../server/game/story/story-loader.ts';
import { storyEngine } from '../server/game/story/story-engine.ts';
import { executeCommand } from '../server/game/commands/command-engine.ts';
import { loadChatroomSubscriptions } from '../server/routes/social/chat-subroutes.ts';
import { companyRepository } from '../server/repositories/company-repository.ts';
import { getCompanyById } from '../server/game/company.ts';
import { socialRepository } from '../server/repositories/social-repository.ts';

async function runTests() {
  console.log('--- Starting Story Gameplay System Verification ---');

  // 1. Verify Story Loader
  storyLoader.loadAllStories();
  const stories = storyLoader.listStories();
  assert.ok(stories.length > 0, 'Should load at least one story');
  const demoStory = storyLoader.getStory('dragon_return');
  assert.ok(demoStory, 'demo story dragon_return should be loaded');
  assert.equal(demoStory.title, '龙王归来：千亿神豪商战');
  assert.equal(demoStory.characters.length, 4);

  // Check character avatars
  const suChar = demoStory.characters.find(c => c.id === 99901);
  assert.ok(suChar);
  assert.equal(suChar.logo, '/static/images/story/01_su_secretary.png');
  console.log('✓ Story Loader, character avatars & JSON Schema validation passed');

  // 2. Test New Company Creation & Personal Assistant Welcome Message
  const uniquePlayerId = Math.floor(8000000 + Math.random() * 1000000);
  const newComp = companyRepository.createCompany(uniquePlayerId, `巅峰实业_${uniquePlayerId}`, 0);
  const companyId = newComp.companyId;
  console.log(`Created new company ID: ${companyId}, Name: ${newComp.name}`);

  const paWelcomeMsgs = socialRepository.listDirectMessages(companyId, 0, undefined, 5);
  assert.ok(paWelcomeMsgs.length > 0, 'PA should have sent a direct welcome message to the new company');
  assert.ok(paWelcomeMsgs[0].message.includes('欢迎来到商业世界，总裁！'), 'PA welcome message content should match');
  console.log('✓ Personal Assistant auto-welcome message on registration passed');

  // 3. Test Chatroom Subscriptions injection
  const subs = loadChatroomSubscriptions(companyId);
  const storyRoom = subs.find(r => r.db_letter === `story_${companyId}`);
  assert.ok(storyRoom, `Dedicated story room story_${companyId} should be present in subscriptions`);
  assert.equal(storyRoom.name, '商界风云·演绎');
  console.log('✓ Dedicated Chatroom room injection passed');

  // 4. Test NPC Character Profile Resolution
  const charNpc = companyRepository.findById(99901);
  assert.ok(charNpc, 'NPC 99901 should resolve via companyRepository');
  assert.equal(charNpc.name, '龙门财阀·苏特助');
  assert.equal(charNpc.logo, '/static/images/story/01_su_secretary.png');
  console.log('✓ NPC Character virtual profile & avatar resolution passed');

  // 5. Test Starting Story via Command
  const cmdResult = await executeCommand('/story start dragon_return', {
    executorCompanyId: companyId,
    isOp: true,
    source: 'pa',
    realmId: 0
  });
  assert.ok(cmdResult.success, 'Command /story start should succeed');

  const state1 = storyEngine.getStoryState(companyId);
  assert.ok(state1, 'Story state should exist in database');
  assert.equal(state1.status, 'active');
  assert.equal(state1.current_stage, 'stage_start');

  // Verify group messages: NO redundant 【角色名】 prefix, and @{{company}} replaced with @CompanyName
  const groupMsgs = socialRepository.listChatMessages(`story_${companyId}`, 10);
  assert.ok(groupMsgs.length >= 2, 'Group messages should be posted to story room');
  for (const m of groupMsgs) {
    assert.ok(!m.text.startsWith('【韩总】'), 'Redundant role brackets should be stripped');
    assert.ok(!m.text.startsWith('【苏特助】'), 'Redundant role brackets should be stripped');
    assert.ok(!m.text.includes('{{company}}'), '{{company}} template should be replaced');
  }
  const mentionMsg = groupMsgs.find(m => m.text.includes(`@${newComp.name}`));
  assert.ok(mentionMsg, `NPC line should mention the player company @${newComp.name}`);
  console.log(`✓ Group messages correctly stripped brackets and dynamically mentioned @${newComp.name}`);

  // Verify direct message with pa-reply HTML
  const directMsgs = socialRepository.listDirectMessages(companyId, 99901, undefined, 5);
  assert.ok(directMsgs.length > 0, 'Direct message from secretary should exist');
  assert.ok(directMsgs[0].message.includes('class="pa-reply"'), 'Direct message should contain pa-reply class');
  assert.ok(directMsgs[0].message.includes('/pa-action/dragon_return/0/'), 'Choice 0 link should be present');
  assert.ok(directMsgs[0].message.includes('/pa-action/dragon_return/1/'), 'Choice 1 link should be present');
  assert.ok(directMsgs[0].message.includes('/pa-action/dragon_return/2/'), 'Choice 2 link should be present');
  console.log('✓ Story Start & Interactive pa-reply generation passed');

  // 6. Test Branch 0: Domination Ending (Ending 1)
  const initialMoney = getCompanyById(companyId)?.money ?? 0;
  const advanceRes0 = await storyEngine.advanceStoryChoice(companyId, 'dragon_return', 0);
  assert.ok(advanceRes0.success, 'Advancing choice 0 should succeed');
  assert.ok(advanceRes0.done, 'done should be true');

  const finalMoney0 = getCompanyById(companyId)?.money ?? 0;
  // Reward for choice 0 is 1,000,000 + finalBonus is 500,000 = 1,500,000
  assert.equal(finalMoney0 - initialMoney, 1500000, 'Money should increase by 1,500,000');

  const stateEnding0 = storyEngine.getStoryState(companyId);
  assert.ok(stateEnding0);
  assert.equal(stateEnding0.status, 'completed');
  assert.equal(stateEnding0.ending_id, 'ending_tycoon');
  console.log('✓ Branch 0 (Ending Tycoon) choice execution & economic rewards passed');

  // 7. Test Reset & Branch 1: Strategist Ending (Ending 2)
  await storyEngine.resetStory(companyId);
  const stateReset = storyEngine.getStoryState(companyId);
  assert.equal(stateReset, null, 'Story state should be null after reset');

  await storyEngine.startStory(companyId, 'dragon_return');
  const advanceRes1 = await storyEngine.advanceStoryChoice(companyId, 'dragon_return', 1);
  assert.ok(advanceRes1.success);
  const stateEnding1 = storyEngine.getStoryState(companyId);
  assert.ok(stateEnding1);
  assert.equal(stateEnding1.status, 'completed');
  assert.equal(stateEnding1.ending_id, 'ending_strategist');
  console.log('✓ Branch 1 (Ending Strategist) choice execution passed');

  // 8. Test Reset & Branch 2: Joker Ending (Ending 3)
  await storyEngine.resetStory(companyId);
  await storyEngine.startStory(companyId, 'dragon_return');
  const advanceRes2 = await storyEngine.advanceStoryChoice(companyId, 'dragon_return', 2);
  assert.ok(advanceRes2.success);
  const stateEnding2 = storyEngine.getStoryState(companyId);
  assert.ok(stateEnding2);
  assert.equal(stateEnding2.status, 'completed');
  assert.equal(stateEnding2.ending_id, 'ending_joker');
  console.log('✓ Branch 2 (Ending Joker) choice execution passed');

  console.log('🎉 ALL STORY GAMEPLAY & PA WELCOME VERIFICATION TESTS PASSED SUCCESSFULLY! 🎉');
}

runTests().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
