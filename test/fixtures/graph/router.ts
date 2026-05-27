import { login, logout } from "./auth.js";

export function handleLogin(user: string, pass: string) {
  return login(user, pass);
}

export function handleLogout(token: string) {
  logout({ userId: "u", token });
}
