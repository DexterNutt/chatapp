import { z } from "zod";
import { createSelectSchema } from "drizzle-zod";
import { chats, chatParticipants, messages, messageAttachments } from "../../lib/schema";

// Create a new chat request
export type CreateChatRequest = z.infer<typeof createChatRequestSchema>;
export const createChatRequestSchema = z
    .object({
        creatorId: z.string().uuid(),
        participantIds: z
            .array(z.string().uuid())
            .min(2, { message: "At least 2 participants required" })
            .max(2, { message: "At most 2 participants allowed" }),
        name: z.string().optional(),
    })
    .strict();

// Send message request
export type SendMessageRequest = z.infer<typeof sendMessageRequestSchema>;
export const sendMessageRequestSchema = z
    .object({
        chatId: z.string().uuid(),
        senderId: z.string().uuid(),
        content: z.string().min(1).max(1000),
        replyToMessageId: z.string().uuid().optional(),
    })
    .strict();

// Chat Participant response
export const chatParticipantResponseSchema = createSelectSchema(chatParticipants, {
    roles: z.enum(["admin", "member"]).array(),
    joinedAt: z.coerce.date(),
    leftAt: z.coerce.date().optional(),
})
    .pick({
        userId: true,
        roles: true,
        joinedAt: true,
        leftAt: true,
    })
    .strict();

// Message response
// Message response
export type MessageResponse = z.infer<typeof messageResponseSchema>;
export const messageResponseSchema = createSelectSchema(messages, {
    textContent: (s) => s.textContent.min(1).max(1000),
    sentAt: z.coerce.date(),
    messageStatus: z.enum(["sent", "delivered", "read", "deleted"]),
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

// Chat response
export type ChatResponse = z.infer<typeof chatResponseSchema>;
export const chatResponseSchema = createSelectSchema(chats, {
    createdAt: z.coerce.date(),
    lastActivity: z.coerce.date(),
})
    .extend({
        participants: z.array(chatParticipantResponseSchema),
        messages: z.array(messageResponseSchema),
        name: z.string().optional(),
    })
    .strict();
