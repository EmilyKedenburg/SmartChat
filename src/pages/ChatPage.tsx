"use client";

import React, { useState, ChangeEvent, FormEvent, useEffect, useRef } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MadeWithDyad } from "@/components/made-with-dyad";
import { X, Send, Loader2, FileText } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useSession } from "@/providers/SessionContextProvider";
import { supabase } from "@/integrations/supabase/client";
import { showSuccess, showError } from "@/utils/toast";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import SourceDisplay from "@/components/SourceDisplay"; // Import the new component

interface Message {
  id: string;
  content: string;
  role: "user" | "assistant";
  created_at: string;
}

interface Source {
  id: string;
  type: string;
  name: string;
  content?: string;
  storage_path?: string;
}

const ChatPage = () => {
  const { session, isLoading: isSessionLoading } = useSession();
  const navigate = useNavigate();

  const [question, setQuestion] = useState<string>("");
  const [files, setFiles] = useState<File[]>([]);
  const [urls, setUrls] = useState<string[]>([""]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [currentChatId, setCurrentChatId] = useState<string | null>(null);
  const [isLoadingResponse, setIsLoadingResponse] = useState<boolean>(false);
  const [isSourcesDialogOpen, setIsSourcesDialogOpen] = useState(false); // State for dialog

  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Define accent colors for consistency
  const primaryAccentColor = "#9CC97F";
  const secondaryAccentColor = "#537E72";

  useEffect(() => {
    if (!isSessionLoading && !session) {
      navigate("/login");
    }
  }, [session, isSessionLoading, navigate]);

  useEffect(() => {
    // Scroll to bottom of messages whenever messages update
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleQuestionChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    setQuestion(e.target.value);
  };

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setFiles(Array.from(e.target.files));
    }
  };

  const handleRemoveFile = (index: number) => {
    setFiles(files.filter((_, i) => i !== index));
  };

  const handleUrlChange = (index: number, value: string) => {
    const newUrls = [...urls];
    newUrls[index] = value;
    setUrls(newUrls);
  };

  const handleAddUrl = () => {
    setUrls([...urls, ""]);
  };

  const handleRemoveUrl = (index: number) => {
    setUrls(urls.filter((_, i) => i !== index));
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!session?.user?.id || isLoadingResponse) return;

    const userId = session.user.id;
    const trimmedQuestion = question.trim();
    const filteredUrls = urls.filter(url => url.trim() !== "");

    if (!trimmedQuestion && files.length === 0 && filteredUrls.length === 0) {
      showError("Please provide a question, files, or URLs.");
      return;
    }

    setIsLoadingResponse(true);

    try {
      let currentChat = currentChatId;
      if (!currentChat) {
        // Create a new chat
        const { data: newChat, error: chatError } = await supabase
          .from("chats")
          .insert({ user_id: userId, title: trimmedQuestion.substring(0, 50) || "New Chat" })
          .select()
          .single();

        if (chatError) throw chatError;
        currentChat = newChat.id;
        setCurrentChatId(newChat.id);
      }

      // Add user message to state and database
      const userMessage: Message = {
        id: crypto.randomUUID(), // Client-side ID for immediate display
        content: trimmedQuestion,
        role: "user",
        created_at: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, userMessage]);

      const { error: insertUserMessageError } = await supabase
        .from("messages")
        .insert({ chat_id: currentChat, user_id: userId, content: trimmedQuestion, role: "user" });
      if (insertUserMessageError) throw insertUserMessageError;

      const sourceIds: string[] = [];

      // Handle file uploads to Supabase Storage and create source entries
      for (const file of files) {
        const filePath = `${userId}/${currentChat}/${file.name}`;
        const { data: uploadData, error: uploadError } = await supabase.storage
          .from("chat-files")
          .upload(filePath, file, {
            cacheControl: "3600",
            upsert: false,
          });

        if (uploadError) {
          console.error("Error uploading file:", uploadError);
          showError(`Failed to upload file ${file.name}: ${uploadError.message}`);
          continue; // Skip to the next file
        }

        // Insert source entry for the uploaded file
        const { data: sourceData, error: insertSourceError } = await supabase
          .from("sources")
          .insert({ chat_id: currentChat, user_id: userId, type: file.type || "application/octet-stream", name: file.name, storage_path: filePath })
          .select("id")
          .single();

        if (insertSourceError) {
          console.error("Error inserting file source:", insertSourceError);
          showError(`Failed to record file source ${file.name}: ${insertSourceError.message}`);
        } else if (sourceData) {
          sourceIds.push(sourceData.id);
        }
      }

      // Handle URLs as sources
      for (const url of filteredUrls) {
        const { data: sourceData, error: insertSourceError } = await supabase
          .from("sources")
          .insert({ chat_id: currentChat, user_id: userId, type: "url", name: url, content: url }) // content initially stores the URL itself
          .select("id")
          .single();

        if (insertSourceError) {
          console.error("Error inserting URL source:", insertSourceError);
          showError(`Failed to record URL source ${url}: ${insertSourceError.message}`);
        } else if (sourceData) {
          sourceIds.push(sourceData.id);
        }
      }

      // Invoke Edge Function with question and source IDs
      const { data, error: edgeFunctionError } = await supabase.functions.invoke("ask-llm", {
        body: { question: trimmedQuestion, sourceIds: sourceIds },
      });

      if (edgeFunctionError) throw edgeFunctionError;
      if (data.error) throw new Error(data.error);

      const assistantResponseContent = data.response || "No response from LLM.";

      // Add assistant message to state and database
      const assistantMessage: Message = {
        id: crypto.randomUUID(), // Client-side ID for immediate display
        content: assistantResponseContent,
        role: "assistant",
        created_at: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, assistantMessage]);

      const { error: insertAssistantMessageError } = await supabase
        .from("messages")
        .insert({ chat_id: currentChat, user_id: userId, content: assistantResponseContent, role: "assistant" });
      if (insertAssistantMessageError) throw insertAssistantMessageError;

      setQuestion("");
      setFiles([]);
      setUrls([""]);
      showSuccess("Response received!");

    } catch (error: any) {
      console.error("Chat submission error:", error);
      showError(`Failed to get response: ${error.message || "Unknown error"}`);
    } finally {
      setIsLoadingResponse(false);
    }
  };

  if (isSessionLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100 dark:bg-gray-900">
        <Loader2 className="h-8 w-8 animate-spin text-gray-600 dark:text-gray-400" />
        <p className="ml-2 text-xl text-gray-600 dark:text-gray-400">Loading session...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-between bg-gray-100 dark:bg-gray-900 p-4">
      <Card className="w-full max-w-2xl bg-white dark:bg-gray-800 shadow-lg rounded-lg flex flex-col h-[90vh]">
        <CardHeader className="pb-4 relative flex items-center justify-center"> {/* Added relative, flex, items-center, justify-center */}
          <CardTitle
            className="text-3xl font-bold text-gray-900 dark:text-white" // Removed flex-grow and text-center from here
            style={{ color: secondaryAccentColor }}
          >
            Smart Chat
          </CardTitle>
          {currentChatId && (
            <Dialog open={isSourcesDialogOpen} onOpenChange={setIsSourcesDialogOpen}>
              <DialogTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="absolute right-4 top-1/2 -translate-y-1/2 dark:text-gray-200 dark:border-gray-600 dark:hover:bg-gray-600" // Absolute positioning
                >
                  <FileText className="h-4 w-4 mr-2" /> View Sources
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-[600px] max-h-[80vh] overflow-y-auto dark:bg-gray-800">
                <DialogHeader>
                  <DialogTitle className="text-gray-900 dark:text-white">Chat Sources</DialogTitle>
                </DialogHeader>
                <SourceDisplay chatId={currentChatId} />
              </DialogContent>
            </Dialog>
          )}
        </CardHeader>
        <CardContent className="flex-grow flex flex-col p-0">
          {/* Message Display Area */}
          <ScrollArea className="flex-grow px-6 pt-6 pb-4 border-t border-b dark:border-gray-700">
            <div className="space-y-4">
              {messages.length === 0 && (
                <div className="text-center text-gray-500 dark:text-gray-400">
                  Start a conversation by asking a question or providing sources.
                </div>
              )}
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`flex items-start gap-3 ${
                    msg.role === "user" ? "justify-end" : "justify-start"
                  }`}
                >
                  {msg.role === "assistant" && (
                    <Avatar>
                      <AvatarImage src="/placeholder.svg" alt="Assistant" />
                      <AvatarFallback style={{ backgroundColor: secondaryAccentColor, color: primaryAccentColor }}>AI</AvatarFallback>
                    </Avatar>
                  )}
                  <div
                    className={`max-w-[70%] p-3 rounded-lg ${
                      msg.role === "user"
                        ? "bg-blue-500 text-white"
                        : "bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-white"
                    }`}
                    style={msg.role === "user" ? { backgroundColor: primaryAccentColor, color: "white" } : {}}
                  >
                    <p className="text-sm">{msg.content}</p>
                    <p className="text-xs text-right mt-1 opacity-75">
                      {new Date(msg.created_at).toLocaleTimeString()}
                    </p>
                  </div>
                  {msg.role === "user" && (
                    <Avatar>
                      <AvatarImage src="/placeholder.svg" alt="User" />
                      <AvatarFallback style={{ backgroundColor: primaryAccentColor, color: secondaryAccentColor }}>
                        {session?.user?.email ? session.user.email[0].toUpperCase() : "U"}
                      </AvatarFallback>
                    </Avatar>
                  )}
                </div>
              ))}
              {messages.length > 0 && <div ref={messagesEndRef} />} {/* Conditionally render messagesEndRef */}
            </div>
          </ScrollArea>

          {/* Input Form */}
          <form onSubmit={handleSubmit} className="p-6 space-y-4 border-t dark:border-gray-700">
            {/* Question Input */}
            <div>
              <Label htmlFor="question" className="sr-only">
                Your Question
              </Label>
              <Textarea
                id="question"
                placeholder="Type your question here..."
                value={question}
                onChange={handleQuestionChange}
                rows={2}
                className="w-full p-3 border rounded-md focus:ring-2 focus:ring-primary dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                disabled={isLoadingResponse}
              />
            </div>

            {/* File Upload */}
            <div>
              <Label htmlFor="file-upload" className="text-sm font-medium mb-2 block">
                Upload Files (Supported: .txt, .pdf, .docx, .csv)
              </Label>
              <Input
                id="file-upload"
                type="file"
                multiple
                onChange={handleFileChange}
                className="block w-full h-auto py-2 text-sm text-gray-500 dark:text-gray-400"
                disabled={isLoadingResponse}
              />
              <div className="mt-2 space-y-1">
                {files.map((file, index) => (
                  <div key={index} className="flex items-center justify-between bg-gray-50 dark:bg-gray-700 p-2 rounded-md">
                    <span className="text-sm text-gray-700 dark:text-gray-300">{file.name}</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => handleRemoveFile(index)}
                      className="text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
                      disabled={isLoadingResponse}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>

            {/* URL Input */}
            <div>
              <Label className="text-sm font-medium mb-2 block">
                Provide Website URLs
              </Label>
              <div className="space-y-2">
                {urls.map((url, index) => (
                  <div key={index} className="flex items-center space-x-2">
                    <Input
                      type="url"
                      placeholder="https://example.com"
                      value={url}
                      onChange={(e) => handleUrlChange(index, e.target.value)}
                      className="flex-grow p-3 border rounded-md focus:ring-2 focus:ring-primary dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                      disabled={isLoadingResponse}
                    />
                    {urls.length > 1 && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => handleRemoveUrl(index)}
                        className="text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
                        disabled={isLoadingResponse}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                ))}
                <Button type="button" onClick={handleAddUrl} variant="outline" className="w-full" disabled={isLoadingResponse}>
                  Add another URL
                </Button>
              </div>
            </div>

            <Button
              type="submit"
              className="w-full py-3 text-lg font-semibold"
              style={{ backgroundColor: primaryAccentColor, color: "#030816" }}
              disabled={isLoadingResponse}
            >
              {isLoadingResponse ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Getting Response...
                </>
              ) : (
                <>
                  <Send className="mr-2 h-4 w-4" />
                  Submit
                </>
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
      <MadeWithDyad />
    </div>
  );
};

export default ChatPage;