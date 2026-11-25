import { cookies } from "next/headers";
import { LoginForm } from "@/components/LoginForm";
import { SIGNUP_COOKIE, googleOn, readSignup } from "@/lib/authflow";
import { captchaOn, captchaSiteKey } from "@/lib/captcha";
import { mailOn } from "@/lib/mail";

export const dynamic = "force-dynamic";

// Страница входа. Что показывать (кнопка Google, капча, «Забыли пароль») — зависит от того, какие ключи заданы на сервере
export default async function LoginPage() {
  const jar = await cookies();
  const g = await readSignup(jar.get(SIGNUP_COOKIE)?.value).catch(() => null);
  return (
    <LoginForm
      google={googleOn()}
      siteKey={captchaOn() ? captchaSiteKey() : null}
      mail={mailOn()}
      signup={g ? { email: g.email, name: g.name } : null}
    />
  );
}
