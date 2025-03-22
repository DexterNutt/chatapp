import { z } from "zod";
import { createSelectSchema } from "drizzle-zod";
import { chats, chatParticipants, messages, messageAttachments } from "../../lib/schema";

export type FetchChatParticipant = z.infer<typeof fetchChatParticipantSchema>;
export const fetchChatParticipantSchema = z.string().uuid();

export type SendMessageRequest = z.infer<typeof sendMessageRequestSchema>;
export const sendMessageRequestSchema = z.object({
    chatId: z.string().uuid(),
    senderId: z.string().uuid(),
    content: z.string().min(1, "Message cannot be empty"),
    replyToMessageId: z.string().uuid().nullable().optional(),
});

export type MessageResponse = z.infer<typeof messageResponseSchema>;
export const messageResponseSchema = createSelectSchema(messages, {
    textContent: (s) => s.textContent.min(1).max(1000),
})
    .extend({
        messageId: z.string().uuid(),
        chatId: z.string().uuid(),
        senderId: z.string().uuid(),
        content: z.string(),
        replyToMessageId: z.string().uuid().nullish(),
        attachments: z
            .array(
                z.object({
                    attachmentId: z.string().uuid(),
                    filePath: z.string(),
                    fileType: z.string(),
                    fileName: z.string(),
                })
            )
            .optional(),
    })
    .strict();

export type FetchMessageAttachment = z.infer<typeof fetchMessageAttachmentsSchema>;
export const fetchMessageAttachmentsSchema = createSelectSchema(messageAttachments, {
    filePath: z.string(),
    fileType: z.string(),
    fileName: z.string(),
})
    .extend({
        attachmentId: z.string().uuid(),
        messageId: z.string().uuid(),
    })
    .strict();

export type CreateChatRequest = z.infer<typeof createChatRequestSchema>;
export const createChatRequestSchema = z.object({
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
        messages: z.array(messageResponseSchema),
        name: z.string().optional().nullable(),
    })
    .strict();
