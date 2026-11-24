import { configurationIssues } from '../server/config.js';
import { createRedis } from '../server/storage.js';
import { getIceServers } from '../server/turn.js';

const issues = configurationIssues(process.env);
if (issues.length) {
  console.error('Production configuration is incomplete.');
  for (const issue of issues) console.error(`- ${issue}`);
  process.exitCode = 1;
} else {
  const redis = createRedis(process.env);
  const results = await Promise.allSettled([
    redis('EVAL', 'return cjson.encode({ready = true})', 0).then((response) => {
      if (JSON.parse(response).ready !== true) throw new Error();
    }),
    getIceServers(process.env),
  ]);
  const services = ['Redis connection and Lua scripting', 'TURN credential issuance'];
  for (const [index, result] of results.entries()) {
    if (result.status === 'fulfilled') {
      console.log(`Passed: ${services[index]}`);
    } else {
      console.error(`Failed: ${services[index]}. Check the provider credentials and service status.`);
      process.exitCode = 1;
    }
  }
}
