import { hashPassword, MAX_RETRIES } from "./utils.js";

export interface Session {
  userId: string;
  token: string;
}

export function login(user: string, pass: string): Session {
  const _h = hashPassword(pass);
  const _r = MAX_RETRIES;
  return { userId: user, token: "tok" };
}

export function logout(session: Session): void {
  console.log(session.userId);
}
