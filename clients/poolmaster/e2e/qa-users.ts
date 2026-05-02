import type { E2EUser } from './poolmaster-e2e-helpers';

export type QARole = 'commissioner' | 'member' | 'rootAdmin';

type QAUser = E2EUser & {
  canSelfRegister: boolean;
  role: QARole;
};

export const qaUsers = {
  commissioner: {
    role: 'commissioner',
    firstName: 'QA',
    lastName: 'Commissioner',
    email: 'derek.dorazio+qa-commissioner@gmail.com',
    username: 'qa-commissioner',
    password: 'poolmaster',
    canSelfRegister: true,
  },
  member: {
    role: 'member',
    firstName: 'QA',
    lastName: 'Member',
    email: 'derek.dorazio+qa-member@gmail.com',
    username: 'qa-member',
    password: 'poolmaster',
    canSelfRegister: true,
  },
  rootAdmin: {
    role: 'rootAdmin',
    firstName: 'poolmaster',
    lastName: 'administrator',
    email: 'derek.dorazio+qa-admin@gmail.com',
    username: 'poolmaster-admin',
    password: 'poolmaster',
    canSelfRegister: false,
  },
} satisfies Record<QARole, QAUser>;

export const qaLeagueSeed = {
  name: 'QA-TEST-LEAGUE',
  code: 'QATESTLEAGUE',
  description: 'Reusable browser e2e fixture league for stable QA coverage.',
};
