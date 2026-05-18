import nodemailer from "nodemailer";

export const transporter = nodemailer.createTransport({
  host: "smtp.hostinger.com",
  port: 465,
  secure: true,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

export async function sendEmail({ to, subject, html }) {
  return transporter.sendMail({
    from: `"Podols" <${process.env.SMTP_USER}>`,
    to,
    subject,
    html,
  });
}
