import path from 'node:path';

export const authStateDir = path.resolve(process.cwd(), 'e2e/.auth');

export const authStatePaths = {
  commissioner: path.join(authStateDir, 'commissioner.json'),
  member: path.join(authStateDir, 'member.json'),
  rootAdmin: path.join(authStateDir, 'root-admin.json'),
};
