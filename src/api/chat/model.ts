import { z } from "zod";
import { createSelectSchema } from "drizzle-zod";
import { chats, messages, messageAttachments } from "../../lib/schema";

export type FetchChatParticipant = z.infer<typeof fetchChatParticipantSchema>;
export const fetchChatParticipantSchema = z.string().uuid();

export type sendMessage = z.infer<typeof sendMessageSchema>;
export const sendMessageSchema = z.object({
    chatId: z.string().uuid(),
    senderId: z.string().uuid(),
    content: z.string().min(1, "Message cannot be empty"),
    replyToMessageId: z.string().uuid().nullable().optional(),
    attachments: z
        .array(
            z.object({
                filename: z.string(),
                contentType: z.string(),
                data: z.string(),
            })
        )
        .optional(),
});

export type MessageAttachment = z.infer<typeof messageAttachmentSchema>;
export const messageAttachmentSchema = createSelectSchema(messageAttachments, {
    fileName: z.string(),
    mimeType: z.string(),
    fileSize: z.number(),
    storagePath: z.string(),
})
    .extend({
        attachmentId: z.string().uuid(),
        messageId: z.string().uuid(),
        url: z.string().optional(),
    })
    .strict();

export type Message = z.infer<typeof messageSchema>;
export const messageSchema = createSelectSchema(messages, {
    textContent: (s) => s.textContent.min(1).max(1000),
})
    .extend({
        messageId: z.string().uuid(),
        chatId: z.string().uuid(),
        senderId: z.string().uuid(),
        content: z.string(),
        replyToMessageId: z.string().uuid().nullish(),
        attachments: z.array(messageAttachmentSchema).optional(),
    })
    .strict();

export type FetchMessageAttachment = z.infer<typeof fetchMessageAttachmentsSchema>;
export const fetchMessageAttachmentsSchema = createSelectSchema(messageAttachments, {
    storagePath: z.string(),
    mimeType: z.string(),
    fileName: z.string(),
})
    .extend({
        attachmentId: z.string().uuid(),
        messageId: z.string().uuid(),
        url: z.string().optional(),
    })
    .strict();

export type CreateChat = z.infer<typeof createChatSchema>;
export const createChatSchema = z.object({
    participantIds: z.array(z.string().uuid()).min(2),
    creatorId: z.string().uuid(),
    name: z.string().optional(),
});

export type Chat = z.infer<typeof chatSchema>;
export const chatSchema = createSelectSchema(chats, {
    chatId: z.string(),
    createdAt: z.coerce.date(),
    lastActivity: z.coerce.date(),
})
    .extend({
        participants: z.array(z.string().uuid()),
        messages: z.array(messageSchema),
        name: z.string().optional().nullable(),
    })
    .strict();
