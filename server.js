import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import nodemailer from "nodemailer";
import dotenv from "dotenv";
import helmet from "helmet";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { z } from "zod";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================================================
// ENVIRONMENT & CONFIGURATION
// ============================================================================

const validateEnv = () => {
  const required = ["GMAIL_USER", "GMAIL_APP_PASSWORD"];
  const missing = required.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    console.error(`❌ Missing environment variables: ${missing.join(", ")}`);
    process.exit(1);
  }
};

const GMAIL_USER = process.env.GMAIL_USER;
const GMAIL_PASS = process.env.GMAIL_APP_PASSWORD;
const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || "development";
const RECIPIENT_EMAILS = [
  process.env.RECIPIENT_EMAIL_1 || "md.sirforce@gmail.com",
  process.env.RECIPIENT_EMAIL_2 || "wpnajmul@gmail.com",
];

// CORS Configuration
const CORS_ORIGIN = process.env.CORS_ORIGIN || [
  "http://localhost:3000",
  "http://localhost:5173",
  "http://localhost:5174",
];

const corsOptions = {
  origin: NODE_ENV === "production" ? CORS_ORIGIN : true,
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  maxAge: 86400,
};

// ============================================================================
// VALIDATION SCHEMA
// ============================================================================

const QuoteSubmissionSchema = z.object({
  fullName: z
    .string()
    .min(2, "Name must be at least 2 characters")
    .max(100, "Name must be less than 100 characters")
    .trim(),
  email: z.string().email("Invalid email address"),
  phone: z
    .string()
    .regex(/^[\d\s\-\+\(\)]+$/, "Invalid phone number")
    .min(7, "Phone must be at least 7 characters"),
  serviceId: z.string().min(1, "Service is required"),
  address: z
    .string()
    .min(5, "Address must be at least 5 characters")
    .max(200, "Address must be less than 200 characters")
    .trim(),
  preferredDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date format"),
  budgetRange: z.string().min(1, "Budget is required"),
  description: z
    .string()
    .min(10, "Description must be at least 10 characters")
    .max(2000, "Description must be less than 2000 characters")
    .trim(),
});

// ============================================================================
// EMAIL TEMPLATE
// ============================================================================

const generateEmailHTML = (data) => {
  const sanitize = (str) => {
    if (!str) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  };

  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif; color: #333; }
          .container { max-width: 600px; margin: 0 auto; border: 1px solid #e0e0e0; border-radius: 8px; overflow: hidden; }
          .header { background: linear-gradient(135deg, #1a1a1a 0%, #2d2d2d 100%); color: white; padding: 30px 20px; }
          .header h2 { margin: 0; font-size: 24px; font-weight: 600; }
          .content { padding: 30px 20px; }
          .field { margin-bottom: 20px; }
          .field-label { font-weight: 600; color: #1a1a1a; margin-bottom: 5px; font-size: 14px; }
          .field-value { color: #555; font-size: 14px; }
          .description-box { background: #f5f5f5; padding: 15px; border-radius: 6px; border-left: 4px solid #8b735b; margin-top: 20px; }
          .footer { background: #fafafa; padding: 15px 20px; font-size: 12px; color: #999; border-top: 1px solid #e0e0e0; }
          .accent { color: #8b735b; font-weight: 600; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h2>🌿 New Landscaping Inquiry</h2>
          </div>
          <div class="content">
            <div class="field">
              <div class="field-label">Contact Name</div>
              <div class="field-value">${sanitize(data.fullName)}</div>
            </div>
            <div class="field">
              <div class="field-label">Email</div>
              <div class="field-value"><a href="mailto:${sanitize(data.email)}">${sanitize(data.email)}</a></div>
            </div>
            <div class="field">
              <div class="field-label">Phone</div>
              <div class="field-value"><a href="tel:${sanitize(data.phone)}">${sanitize(data.phone)}</a></div>
            </div>
            <div class="field">
              <div class="field-label">Service Type</div>
              <div class="field-value"><span class="accent">${sanitize(data.serviceId)}</span></div>
            </div>
            <div class="field">
              <div class="field-label">Project Address</div>
              <div class="field-value">${sanitize(data.address)}</div>
            </div>
            <div class="field">
              <div class="field-label">Preferred Date</div>
              <div class="field-value">${sanitize(data.preferredDate)}</div>
            </div>
            <div class="field">
              <div class="field-label">Budget Range</div>
              <div class="field-value"><span class="accent">${sanitize(data.budgetRange)}</span></div>
            </div>
            <div class="description-box">
              <div class="field-label" style="margin-bottom: 10px;">Project Description</div>
              <div class="field-value">${sanitize(data.description).replace(/\n/g, "<br>")}</div>
            </div>
          </div>
          <div class="footer">
            <p style="margin: 0;">✓ Lead submitted via Green Stone Atlantic website</p>
            <p style="margin: 5px 0 0 0; color: #bbb;">Timestamp: ${new Date().toLocaleString()}</p>
          </div>
        </div>
      </body>
    </html>
  `;
};

// ============================================================================
// EMAIL TRANSPORTER (SINGLETON)
// ============================================================================

let emailTransporter = null;

const getEmailTransporter = () => {
  if (!emailTransporter) {
    emailTransporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: GMAIL_USER,
        pass: GMAIL_PASS,
      },
      pool: {
        maxConnections: 1,
        maxMessages: 5,
        rateDelta: 4000,
        rateLimit: 5,
      },
    });
  }
  return emailTransporter;
};

// ============================================================================
// RATE LIMITING
// ============================================================================

const quoteRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 requests per windowMs
  message: "Too many quote submissions, please try again later",
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => NODE_ENV === "development",
});

// ============================================================================
// MIDDLEWARE & ERROR HANDLING
// ============================================================================

class AppError extends Error {
  constructor(message, statusCode) {
    super(message);
    this.statusCode = statusCode;
  }
}

const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

const errorHandler = (err, req, res, next) => {
  const statusCode = err.statusCode || 500;
  const isDev = NODE_ENV === "development";

  console.error(`[${new Date().toISOString()}] Error:`, {
    status: statusCode,
    message: err.message,
    ...(isDev && { stack: err.stack }),
  });

  // Don't expose internal error details in production
  const message =
    isDev || statusCode === 400 ? err.message : "Internal server error";

  res.status(statusCode).json({
    success: false,
    error: message,
    ...(isDev && { stack: err.stack }),
  });
};

// ============================================================================
// SERVER SETUP
// ============================================================================

async function startServer() {
  validateEnv();

  const app = express();

  // Security middleware
  app.use(helmet());
  app.use(cors(corsOptions));
  app.use(express.json({ limit: "10mb" }));
  app.use(express.urlencoded({ limit: "10mb", extended: true }));

  // Request logging (production)
  if (NODE_ENV === "production") {
    app.use((req, res, next) => {
      const start = Date.now();
      res.on("finish", () => {
        const duration = Date.now() - start;
        console.log(
          `[${new Date().toISOString()}] ${req.method} ${req.path} ${res.statusCode} ${duration}ms`
        );
      });
      next();
    });
  }

  // ========================================================================
  // API ROUTES
  // ========================================================================

  // Health check
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  // Quote submission endpoint
  app.post(
    "/api/quote",
    quoteRateLimiter,
    asyncHandler(async (req, res) => {
      // Validate request body
      const validationResult = QuoteSubmissionSchema.safeParse(req.body);
      if (!validationResult.success) {
        throw new AppError(
          `Validation error: ${validationResult.error.errors
            .map((e) => `${e.path.join(".")}: ${e.message}`)
            .join(", ")}`,
          400
        );
      }

      const data = validationResult.data;
      console.log(`[${new Date().toISOString()}] New quote submission:`, {
        email: data.email,
        serviceId: data.serviceId,
      });

      try {
        const transporter = getEmailTransporter();
        const emailHTML = generateEmailHTML(data);

        await transporter.sendMail({
          from: {
            name: "Green Stone Atlantic",
            address: GMAIL_USER,
          },
          to: RECIPIENT_EMAILS,
          replyTo: data.email,
          subject: `New Lead: ${data.fullName} - ${data.serviceId}`,
          html: emailHTML,
          text: `Name: ${data.fullName}\nEmail: ${data.email}\nPhone: ${data.phone}\nService: ${data.serviceId}\n\nDescription:\n${data.description}`,
        });

        console.log(
          `[${new Date().toISOString()}] Email sent successfully for: ${data.email}`
        );
        res.json({
          success: true,
          message: "Quote submission received. We'll contact you shortly!",
        });
      } catch (emailError) {
        console.error(
          `[${new Date().toISOString()}] Email service error:`,
          emailError.message
        );
        throw new AppError(
          "Failed to process your submission. Please try again later.",
          500
        );
      }
    })
  );

  // ========================================================================
  // VITE MIDDLEWARE
  // ========================================================================

  if (NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath, { maxAge: "1d" }));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  // ========================================================================
  // ERROR HANDLING
  // ========================================================================

  app.use((req, res) => {
    res.status(404).json({ success: false, error: "Route not found" });
  });

  app.use(errorHandler);

  // ========================================================================
  // SERVER STARTUP
  // ========================================================================

  const server = app.listen(PORT, "0.0.0.0", () => {
    console.log(`

  Green Stone Atlantic Backend Server    

  Port: ${PORT}
  Environment: ${NODE_ENV}
 Status: 🟢 Running

    `);
  });

  // Graceful shutdown
  const gracefulShutdown = async () => {
    console.log("\n🛑 Shutting down gracefully...");

    server.close(() => {
      console.log("✓ HTTP server closed");
      process.exit(0);
    });

    // Force shutdown after 10 seconds
    setTimeout(() => {
      console.error("❌ Force shutting down");
      process.exit(1);
    }, 10000);
  };

  process.on("SIGTERM", gracefulShutdown);
  process.on("SIGINT", gracefulShutdown);

  process.on("unhandledRejection", (reason, promise) => {
    console.error(
      `[${new Date().toISOString()}] Unhandled Rejection at:`,
      promise,
      "reason:",
      reason
    );
  });
}

startServer().catch((error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});