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
    const existingUser = await db.query.users.findFirst({
      where: eq(users.username, 'ROTTIE'),
    });

    const DEFAULT_PASSWORD = 'R11r11r';

    if (!existingUser) {
      console.log('Creating ROTTIE user...');
      const hashedPassword = await crypto.hash(DEFAULT_PASSWORD);
      await db.insert(users).values({
        username: 'ROTTIE',
        password: hashedPassword,
      });
      console.log('Created initial ROTTIE user successfully');
    } else {
      console.log('ROTTIE user already exists');
      const hashedPassword = await crypto.hash(DEFAULT_PASSWORD);
      await db.update(users)
        .set({ password: hashedPassword })
        .where(eq(users.username, 'ROTTIE'));
      console.log('Updated ROTTIE user password');
    }
  } catch (error) {
    console.error('Error managing initial user:', error);
    throw error;
  }
}

export function setupAuth(app: Express) {
  const MemoryStore = createMemoryStore(session);
  const sessionSettings: session.SessionOptions = {
    secret: process.env.REPL_ID || 'secure-session-secret',
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
      httpOnly: true
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
      const user = await db.query.users.findFirst({
        where: eq(users.id, id),
      });
      done(null, user);
    } catch (err) {
      console.error('Deserialization error:', err);
      done(err);
    }
  });

  app.post("/api/login", (req, res, next) => {
    passport.authenticate("local", async (err: any, user: User | false, info: IVerifyOptions) => {
      if (err) {
        console.error('Authentication error:', err);
        return res.status(500).json({ success: false, message: "Internal server error" });
      }

      if (!user) {
        return res.status(401).json({
          success: false,
          message: info.message || "Authentication failed"
        });
      }

      // Log in the user immediately without verification for now
      req.login(user, (err) => {
        if (err) {
          console.error('Login error:', err);
          return res.status(500).json({
            success: false,
            message: "Error completing login"
          });
        }

        return res.json({
          success: true,
          user: {
            id: user.id,
            username: user.username
          }
        });
      });
    })(req, res, next);
  });

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