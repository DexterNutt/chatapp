import { z } from "zod";
import { createSelectSchema } from "drizzle-zod";
import { chats, messages, messageAttachments } from "../../lib/schema";

//* Attachments
export type MessageAttachment = z.infer<typeof messageAttachmentSchema>;
export const messageAttachmentSchema = createSelectSchema(messageAttachments, {
    fileName: z.string().min(1).max(255),
    mimeType: z.string().regex(/^[a-z]+\/[a-z0-9\-+.]+$/i),
    fileSize: z
        .number()
        .min(0)
        .max(5 * 1024 * 1024),
    storagePath: z.string(),
})
    .extend({
        attachmentId: z.string().uuid(),
        messageId: z.string().uuid(),
        url: z.string().optional(),
        uploadedAt: z.date().optional(),
    })
    .strict();

export type UploadAttachmentRequest = z.infer<typeof uploadAttachmentSchema>;
export const uploadAttachmentSchema = z
    .object({
        data: z.string().min(1, "Base64 data is required"),
        fileName: z.string().min(1).max(255),
        mimeType: z.string().regex(/^[a-z]+\/[a-z0-9\-+.]+$/i),
        messageId: z.string().uuid().optional(),
    })
    .strict();

export type FetchMessageAttachment = z.infer<typeof fetchMessageAttachmentSchema>;
export const fetchMessageAttachmentSchema = messageAttachmentSchema.pick({ attachmentId: true });

//*Messages
export type Message = z.infer<typeof messageSchema>;
export const messageSchema = z
    .object({
        messageId: z.string().uuid(),
        chatId: z.string().uuid(),
        senderId: z.string().uuid(),
        textContent: z.string(),
        createdAt: z.coerce.date(),
        attachments: z.array(messageAttachmentSchema).optional(),
    })
    .strict();

export type SendMessage = z.infer<typeof sendMessageSchema>;
export const sendMessageSchema = messageSchema
    .omit({
        messageId: true,
        createdAt: true,
    })
    .extend({
        textContent: z.string().min(1, "Message cannot be empty"),
        attachments: z
            .array(
                z.object({
                    filename: z.string().min(1, "Filename cannot be empty").max(255, "Filename is too long"),
                    contentType: z.string().regex(/^[a-z]+\/[a-z0-9\-+.]+$/i, "Invalid content type"),
                    data: z.string(),
                })
            )
            .optional(),
    });

export type FetchMessagesRequest = z.infer<typeof fetchMessagesRequestSchema>;
export const fetchMessagesRequestSchema = z.object({
    chatId: z.string().uuid(),
    userId: z.string().uuid(),
});

export type FetchMessagesResponse = z.infer<typeof fetchMessagesResponseSchema>;
export const fetchMessagesResponseSchema = z.object({
    messages: z.array(messageSchema),
});

//*Chats
export type Chat = z.infer<typeof chatSchema>;
export const chatSchema = createSelectSchema(chats, {
    chatId: z.string().uuid(),
    createdAt: z.coerce.date(),
    lastActivity: z.coerce.date(),
    name: z.string().optional().nullable(),
})
    .extend({
        participants: z.array(z.string().uuid()),
        messages: z.array(messageSchema).optional(),
    })
    .strict();

export type CreateChat = z.infer<typeof createChatSchema>;
export const createChatSchema = chatSchema
    .omit({
        chatId: true,
        createdAt: true,
        lastActivity: true,
    })
    .extend({
        creatorId: z.string().uuid(),
    });

export type FetchChatDetailsRequest = z.infer<typeof fetchChatDetailsRequestSchema>;
export const fetchChatDetailsRequestSchema = z.object({
    chatId: z.string().uuid(),
    userId: z.string().uuid(),
});

export type FetchChatsRequest = z.infer<typeof fetchChatsRequestSchema>;
export const fetchChatsRequestSchema = z.object({
    userId: z.string().uuid(),
});

export type FetchChatsResponse = z.infer<typeof fetchChatsResponseSchema>;
export const fetchChatsResponseSchema = z.object({
    chats: z.array(chatSchema),
});

export type ChatParticipant = z.infer<typeof chatParticipantSchema>;
export const chatParticipantSchema = z.object({
    participantId: z.string().uuid(),
    chatId: z.string().uuid(),
    joinedAt: z.coerce.date(),
    role: z.enum(["admin", "member"]),
});

export type FetchChatParticipantsRequest = z.infer<typeof fetchChatParticipantsRequestSchema>;
export const fetchChatParticipantsRequestSchema = chatParticipantSchema.pick({ chatId: true });

export type FetchChatParticipantsResponse = z.infer<typeof fetchChatParticipantsResponseSchema>;
export const fetchChatParticipantsResponseSchema = z.object({
    participants: z.array(chatParticipantSchema),
});
