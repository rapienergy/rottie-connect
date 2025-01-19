import passport from "passport";
import { IVerifyOptions, Strategy as LocalStrategy } from "passport-local";
import { type Express } from "express";
import session from "express-session";
import createMemoryStore from "memorystore";
import { scrypt, randomBytes, timingSafeEqual } from "crypto";
import { promisify } from "util";
import { users, insertUserSchema, type User } from "@db/schema";
import { db } from "@db";
import { eq } from "drizzle-orm";
import { VerificationService } from "./verification";

const scryptAsync = promisify(scrypt);
const crypto = {
  hash: async (password: string) => {
    const salt = randomBytes(16).toString("hex");
    const buf = (await scryptAsync(password, salt, 64)) as Buffer;
    return `${buf.toString("hex")}.${salt}`;
  },
  compare: async (suppliedPassword: string, storedPassword: string) => {
    const [hashedPassword, salt] = storedPassword.split(".");
    const hashedPasswordBuf = Buffer.from(hashedPassword, "hex");
    const suppliedPasswordBuf = (await scryptAsync(
      suppliedPassword,
      salt,
      64
    )) as Buffer;
    return timingSafeEqual(hashedPasswordBuf, suppliedPasswordBuf);
  },
};

// Extend express user object with our schema
declare global {
  namespace Express {
    interface User extends User { }
  }
}

export async function createInitialUser() {
  try {
    // Check if ROTTIE user exists
    const [existingUser] = await db
      .select()
      .from(users)
      .where(eq(users.username, 'ROTTIE'))
      .limit(1);

    if (!existingUser) {
      // Create ROTTIE user with specified password
      const hashedPassword = await crypto.hash('R11r11r');
      await db.insert(users).values({
        username: 'ROTTIE',
        password: hashedPassword,
      });
      console.log('Created initial ROTTIE user');
    }
  } catch (error) {
    console.error('Error creating initial user:', error);
  }
}

export function setupAuth(app: Express) {
  const MemoryStore = createMemoryStore(session);
  const sessionSettings: session.SessionOptions = {
    secret: process.env.REPL_ID || "rottie-connect-session",
    resave: false,
    saveUninitialized: false,
    cookie: {},
    store: new MemoryStore({
      checkPeriod: 86400000, // prune expired entries every 24h
    }),
  };

  if (app.get("env") === "production") {
    app.set("trust proxy", 1);
    sessionSettings.cookie = {
      secure: true,
      sameSite: 'strict'
    };
  }

  app.use(session(sessionSettings));
  app.use(passport.initialize());
  app.use(passport.session());

  passport.use(
    new LocalStrategy(async (username, password, done) => {
      try {
        const [user] = await db
          .select()
          .from(users)
          .where(eq(users.username, username))
          .limit(1);

        if (!user) {
          return done(null, false, { message: "Invalid credentials" });
        }
        const isMatch = await crypto.compare(password, user.password);
        if (!isMatch) {
          return done(null, false, { message: "Invalid credentials" });
        }
        return done(null, user);
      } catch (err) {
        return done(err);
      }
    })
  );

  passport.serializeUser((user, done) => {
    done(null, user.id);
  });

  passport.deserializeUser(async (id: number, done) => {
    try {
      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.id, id))
        .limit(1);
      done(null, user);
    } catch (err) {
      done(err);
    }
  });

  // Login endpoint with two-step verification
  app.post("/api/login", (req, res, next) => {
    const result = insertUserSchema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).send("Invalid input");
    }

    passport.authenticate("local", async (err: any, user: Express.User, info: IVerifyOptions) => {
      if (err) {
        return next(err);
      }
      if (!user) {
        return res.status(401).json({
          success: false,
          message: info.message || "Authentication failed"
        });
      }

      try {
        // Send verification code to WhatsApp
        const verificationCode = await VerificationService.createVerification("+5215584277211");

        // Store user data in session for verification step
        req.session.pendingUser = {
          id: user.id,
          username: user.username
        };

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
  app.post("/api/verify", async (req, res, next) => {
    const { code } = req.body;
    const pendingUser = req.session.pendingUser;

    if (!pendingUser) {
      return res.status(400).json({
        success: false,
        message: "No pending verification"
      });
    }

    try {
      const verified = await VerificationService.verifyCode("+5215584277211", code);
      if (verified) {
        // Complete login
        const [user] = await db
          .select()
          .from(users)
          .where(eq(users.id, pendingUser.id))
          .limit(1);

        req.login(user, (err) => {
          if (err) {
            return next(err);
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
      return res.status(400).json({
        success: false,
        message: error.message
      });
    }
  });

  // Logout endpoint
  app.post("/api/logout", (req, res) => {
    req.logout((err) => {
      if (err) {
        return res.status(500).json({
          success: false,
          message: "Logout failed"
        });
      }
      res.json({
        success: true,
        message: "Logged out successfully"
      });
    });
  });

  // Get current user
  app.get("/api/user", (req, res) => {
    if (req.isAuthenticated()) {
      return res.json({
        id: req.user.id,
        username: req.user.username
      });
    }
    res.status(401).send("Not authenticated");
  });

  // Create initial ROTTIE user
  createInitialUser();
}