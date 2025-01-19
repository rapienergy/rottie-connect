import passport from "passport";
import { IVerifyOptions, Strategy as LocalStrategy } from "passport-local";
import { type Express } from "express";
import session from "express-session";
import createMemoryStore from "memorystore";
import { scrypt, randomBytes, timingSafeEqual } from "crypto";
import { promisify } from "util";
import { users, type User } from "@db/schema";
import { db } from "@db";
import { eq } from "drizzle-orm";
import { VerificationService } from "./verification";
import { CONFIG } from "./config";

const scryptAsync = promisify(scrypt);

// Extend express session
declare module "express-session" {
  interface SessionData {
    pendingUser?: {
      id: number;
      username: string;
    };
  }
}

const crypto = {
  hash: async (password: string): Promise<string> => {
    const salt = randomBytes(16).toString("hex");
    const buf = await scryptAsync(password, salt, 64) as Buffer;
    return `${buf.toString("hex")}.${salt}`;
  },
  compare: async (suppliedPassword: string, storedPassword: string): Promise<boolean> => {
    try {
      const [hashedPassword, salt] = storedPassword.split(".");
      if (!hashedPassword || !salt) {
        console.error('Invalid stored password format');
        return false;
      }
      const hashedPasswordBuf = Buffer.from(hashedPassword, "hex");
      const suppliedPasswordBuf = await scryptAsync(suppliedPassword, salt, 64) as Buffer;
      return timingSafeEqual(hashedPasswordBuf, suppliedPasswordBuf);
    } catch (error) {
      console.error('Error comparing passwords:', error);
      return false;
    }
  },
};

export async function createInitialUser() {
  try {
    console.log('Checking for ROTTIE user...');
    // Check if ROTTIE user exists
    const existingUser = await db.query.users.findFirst({
      where: eq(users.username, 'ROTTIE'),
    });

    if (!existingUser) {
      console.log('Creating ROTTIE user...');
      // Create ROTTIE user with specified password
      const hashedPassword = await crypto.hash('R11r11r');
      await db.insert(users).values({
        username: 'ROTTIE',
        password: hashedPassword,
      });
      console.log('Created initial ROTTIE user successfully');
    } else {
      console.log('ROTTIE user already exists');
      // Update password if needed
      const hashedPassword = await crypto.hash('R11r11r');
      await db.update(users)
        .set({ password: hashedPassword })
        .where(eq(users.username, 'ROTTIE'));
      console.log('Updated ROTTIE user password');
    }
  } catch (error) {
    console.error('Error managing initial user:', error);
    throw error; // Rethrow to handle it in the setup
  }
}

export function setupAuth(app: Express) {
  const MemoryStore = createMemoryStore(session);
  const sessionSettings: session.SessionOptions = {
    secret: process.env.REPL_ID || CONFIG.SESSION.COOKIE_NAME,
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: CONFIG.SESSION.MAX_AGE
    },
    store: new MemoryStore({
      checkPeriod: 86400000, // prune expired entries every 24h
    }),
  };

  if (app.get("env") === "production") {
    app.set("trust proxy", 1);
    sessionSettings.cookie = {
      ...sessionSettings.cookie,
      secure: true,
      sameSite: 'lax'
    };
  }

  app.use(session(sessionSettings));
  app.use(passport.initialize());
  app.use(passport.session());

  passport.use(
    new LocalStrategy(async (username, password, done) => {
      try {
        console.log('Attempting login for username:', username);
        const user = await db.query.users.findFirst({
          where: eq(users.username, username),
        });

        if (!user) {
          console.log('User not found:', username);
          return done(null, false, { message: "Invalid credentials" });
        }

        const isMatch = await crypto.compare(password, user.password);
        if (!isMatch) {
          console.log('Password mismatch for user:', username);
          return done(null, false, { message: "Invalid credentials" });
        }

        console.log('Login successful for user:', username);
        return done(null, user);
      } catch (err) {
        console.error('Login error:', err);
        return done(err);
      }
    })
  );

  passport.serializeUser((user: User, done) => {
    console.log('Serializing user:', user.id);
    done(null, user.id);
  });

  passport.deserializeUser(async (id: number, done) => {
    try {
      console.log('Deserializing user:', id);
      const user = await db.query.users.findFirst({
        where: eq(users.id, id),
      });
      done(null, user);
    } catch (err) {
      console.error('Deserialization error:', err);
      done(err);
    }
  });

  // Login endpoint with two-step verification
  app.post("/api/login", (req, res, next) => {
    console.log('Login attempt:', req.body);
    passport.authenticate("local", async (err: any, user: User | false, info: IVerifyOptions) => {
      if (err) {
        console.error('Authentication error:', err);
        return res.status(500).json({
          success: false,
          message: "Internal server error"
        });
      }

      if (!user) {
        return res.status(401).json({
          success: false,
          message: info.message || "Authentication failed"
        });
      }

      try {
        console.log('Creating verification for user:', user.username);
        // Send verification code to WhatsApp
        const verificationCode = await VerificationService.createVerification(CONFIG.VERIFICATION.TEST_PHONE_NUMBER);
        console.log('Verification code created:', verificationCode);

        // Store user data in session for verification step
        req.session.pendingUser = {
          id: user.id,
          username: user.username
        };
        console.log('Stored pending user in session:', req.session.pendingUser);

        return res.json({
          success: true,
          message: "Verification code sent to WhatsApp",
          requireVerification: true
        });
      } catch (error: any) {
        console.error('Verification error:', error);
        return res.status(500).json({
          success: false,
          message: error.message || "Error sending verification code"
        });
      }
    })(req, res, next);
  });

  // Verify WhatsApp code endpoint
  app.post("/api/verify", async (req, res) => {
    const { code } = req.body;
    const pendingUser = req.session.pendingUser;

    if (!pendingUser) {
      return res.status(400).json({
        success: false,
        message: "No pending verification"
      });
    }

    try {
      console.log('Verifying code for pending user:', pendingUser);
      const verified = await VerificationService.verifyCode(CONFIG.VERIFICATION.TEST_PHONE_NUMBER, code);
      if (verified) {
        // Complete login
        const user = await db.query.users.findFirst({
          where: eq(users.id, pendingUser.id),
        });

        if (!user) {
          throw new Error("User not found");
        }

        req.login(user, (err) => {
          if (err) {
            console.error('Login error after verification:', err);
            return res.status(500).json({
              success: false,
              message: "Error completing login"
            });
          }
          // Clear pending user
          delete req.session.pendingUser;
          return res.json({
            success: true,
            user: {
              id: user.id,
              username: user.username
            }
          });
        });
      } else {
        res.status(400).json({
          success: false,
          message: "Invalid verification code"
        });
      }
    } catch (error: any) {
      console.error('Verification error:', error);
      return res.status(400).json({
        success: false,
        message: error.message
      });
    }
  });

  // Get current user
  app.get("/api/user", (req, res) => {
    if (req.isAuthenticated()) {
      const user = req.user as User;
      return res.json({
        id: user.id,
        username: user.username
      });
    }
    res.status(401).json({
      success: false,
      message: "Not authenticated"
    });
  });

  // Create initial ROTTIE user
  createInitialUser().catch(error => {
    console.error('Failed to create initial user:', error);
  });
}