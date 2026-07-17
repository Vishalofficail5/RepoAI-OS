const users = new Map([
  ['usr_demo', { id: 'usr_demo', email: 'developer@acme.test', role: 'developer' }]
]);

export function findUser(userId) {
  return users.get(userId);
}
