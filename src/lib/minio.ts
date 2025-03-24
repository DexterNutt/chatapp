import { Client } from "minio";

export const minioClient = new Client({
    endPoint: process.env.MINIO_ENDPOINT || "localhost",
    port: parseInt(process.env.MINIO_PORT || "9000"),
    useSSL: false,
    accessKey: process.env.MINIO_ACCESS_KEY || "minioadmin",
    secretKey: process.env.MINIO_SECRET_KEY || "minioadmin",
});

export const BUCKET_NAME = "chat-attachments";

async function ensureBucketExists() {
    const exists = await minioClient.bucketExists(BUCKET_NAME);
    if (!exists) {
        await minioClient.makeBucket(BUCKET_NAME, "us-east-1");
        console.log(`Bucket ${BUCKET_NAME} created`);
    }
}

ensureBucketExists().catch(console.error);
