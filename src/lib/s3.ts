import { S3Client } from "@aws-sdk/client-s3";

export const s3Client = new S3Client({
    region: process.env.AWS_REGION || "eu-north-1",
});

export const BUCKET_NAME = process.env.S3_BUCKET_NAME || "chat-attachments";
