import { useState, useEffect, useRef } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { useUser } from "@/hooks/use-user";

const loginSchema = z.object({
  username: z.string().min(1, "Username is required"),
  password: z.string().min(1, "Password is required"),
});

const verificationSchema = z.object({
  code: z.string().length(6, "Verification code must be 6 digits"),
});

type LoginForm = z.infer<typeof loginSchema>;
type VerificationForm = z.infer<typeof verificationSchema>;

export default function AuthPage() {
  const { login, verify } = useUser();
  const [isLoading, setIsLoading] = useState(false);
  const [showVerification, setShowVerification] = useState(false);
  const [digits, setDigits] = useState(['', '', '', '', '', '']);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const [lastVerifyAttempt, setLastVerifyAttempt] = useState<string>('');

  const loginForm = useForm<LoginForm>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      username: "",
      password: "",
    },
  });

  const verificationForm = useForm<VerificationForm>({
    resolver: zodResolver(verificationSchema),
    defaultValues: {
      code: "",
    },
  });

  // Reset forms when switching modes
  useEffect(() => {
    if (showVerification) {
      verificationForm.reset();
      setDigits(['', '', '', '', '', '']);
      setLastVerifyAttempt('');
    } else {
      loginForm.reset();
    }
  }, [showVerification]);

  // Auto-verify when all digits are entered
  useEffect(() => {
    const code = digits.join('');
    if (code.length === 6 && code !== lastVerifyAttempt) {
      verificationForm.setValue('code', code);
      handleVerification(code);
    }
  }, [digits]);

  async function onSubmitLogin(data: LoginForm) {
    setIsLoading(true);
    try {
      const result = await login(data);
      if (result.requireVerification) {
        setShowVerification(true);
      }
    } finally {
      setIsLoading(false);
    }
  }

  async function handleVerification(code: string) {
    if (isLoading || code === lastVerifyAttempt) return;

    setIsLoading(true);
    setLastVerifyAttempt(code);
    try {
      await verify(code);
    } catch (error) {
      console.error('Verification failed:', error);
    } finally {
      setIsLoading(false);
    }
  }

  async function onSubmitVerification(data: VerificationForm) {
    handleVerification(data.code);
  }

  const handleDigitChange = (index: number, value: string) => {
    if (!/^\d*$/.test(value)) return; // Only allow digits

    const newDigits = [...digits];
    newDigits[index] = value;
    setDigits(newDigits);

    // Auto-focus next input
    if (value && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !digits[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle>RottieConnect Login</CardTitle>
          <CardDescription>
            {showVerification 
              ? "Enter the verification code sent to your WhatsApp"
              : "Enter your credentials to access the platform"
            }
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!showVerification ? (
            <Form {...loginForm}>
              <form onSubmit={loginForm.handleSubmit(onSubmitLogin)} className="space-y-4">
                <FormField
                  control={loginForm.control}
                  name="username"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Username</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          autoComplete="username"
                          disabled={isLoading}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={loginForm.control}
                  name="password"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Password</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          type="password"
                          autoComplete="current-password"
                          disabled={isLoading}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <CardFooter className="px-0">
                  <Button
                    type="submit"
                    className="w-full"
                    disabled={isLoading}
                  >
                    {isLoading ? "Authenticating..." : "Login"}
                  </Button>
                </CardFooter>
              </form>
            </Form>
          ) : (
            <Form {...verificationForm}>
              <form onSubmit={verificationForm.handleSubmit(onSubmitVerification)} className="space-y-4">
                <FormField
                  control={verificationForm.control}
                  name="code"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Verification Code</FormLabel>
                      <FormControl>
                        <div className="flex justify-center gap-2">
                          {digits.map((digit, index) => (
                            <input
                              key={index}
                              ref={el => inputRefs.current[index] = el}
                              type="text"
                              inputMode="numeric"
                              pattern="\d*"
                              maxLength={1}
                              value={digit}
                              onChange={(e) => handleDigitChange(index, e.target.value)}
                              onKeyDown={(e) => handleKeyDown(index, e)}
                              className="w-12 h-14 text-center text-2xl border rounded-md focus:outline-none focus:ring-2 focus:ring-primary bg-background text-foreground"
                              disabled={isLoading}
                            />
                          ))}
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <CardFooter className="px-0">
                  <Button
                    type="submit"
                    className="w-full"
                    disabled={isLoading || digits.join('').length !== 6}
                  >
                    {isLoading ? "Verifying..." : "Verify"}
                  </Button>
                </CardFooter>
              </form>
            </Form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}