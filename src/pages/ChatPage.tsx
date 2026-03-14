"use client";

import React, { useState, ChangeEvent, FormEvent, useEffect, useRef } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MadeWithDyad } from "@/components/made-with-dyad";
import { X, Send, Loader2, FileText, LogOut, User } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useSession } from "@/providers/SessionContextProvider";
import { supabase } from "@/integrations/supabase/client";
import { showSuccess, showError } from "@/utils/toast";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import SourceDisplay from "@/components/SourceDisplay";

interface Message {
  id: string;
  content: string;
  role: "user" | "assistant";
  created_at: string;
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
  const [isSourcesDialogOpen, setIsSourcesDialogOpen] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  const primaryAccentColor = "#9CC97F";
  const secondaryAccentColor = "#537E72";

  useEffect(() => {
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

  const handleLogout = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) {
      showError("Failed to log out.");
    } else {
      showSuccess("Logged out successfully!");
      navigate("/login");
    }
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
    console.log("Submitting chat request...", { userId, trimmedQuestion, filesCount: files.length, urlsCount: filteredUrls.length });

    try {
      let currentChat = currentChatId;
      let allSourceIdsForLLM: string[] = [];

      // 1. Ensure we have a chat ID
      if (!currentChat) {
        console.log("Creating new chat...");
        const { data: newChat, error: chatError } = await supabase
          .from("chats")
          .insert({ user_id: userId, title: trimmedQuestion.substring(0, 50) || "New Chat" })
          .select()
          .single();

        if (chatError) {
          console.error("Error creating chat:", chatError);
          throw new Error(`Failed to create chat: ${chatError.message}`);
        }
        currentChat = newChat.id;
        setCurrentChatId(newChat.id);
        console.log("New chat created:", currentChat);
      } else {
        console.log("Using existing chat:", currentChat);
        // Fetch existing sources for this chat to maintain context
        const { data: existingSources, error: fetchExistingSourcesError } = await supabase
          .from("sources")
          .select("id")
          .eq("chat_id", currentChat)
          .eq("user_id", userId);

        if (!fetchExistingSourcesError && existingSources) {
          allSourceIdsForLLM = existingSources.map(s => s.id);
          console.log("Fetched existing source IDs:", allSourceIdsForLLM);
        }
      }

      // 2. Add user message to UI and DB
      const userMessage: Message = {
        id: crypto.randomUUID(),
        content: trimmedQuestion,
        role: "user",
        created_at: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, userMessage]);

      const { error: msgError } = await supabase
        .from("messages")
        .insert({ chat_id: currentChat, user_id: userId, content: trimmedQuestion, role: "user" });
      
      if (msgError) {
        console.error("Error saving user message:", msgError);
      }

      // 3. Process new files
      const fileProcessingPromises = files.map(async (file) => {
        console.log(`Uploading file: ${file.name}`);
        const filePath = `${userId}/${currentChat}/${Date.now()}_${file.name}`;
        const { error: uploadError } = await supabase.storage
          .from("chat-files")
          .upload(filePath, file, { upsert: true });

        if (uploadError) {
          console.error(`Upload error for ${file.name}:`, uploadError);
          showError(`Failed to upload ${file.name}: ${uploadError.message}`);
          return null;
        }

        console.log(`File ${file.name} uploaded, creating source record...`);
        const { data: sourceData, error: insertSourceError } = await supabase
          .from("sources")
          .insert({ 
            chat_id: currentChat, 
            user_id: userId, 
            type: file.type || "application/octet-stream", 
            name: file.name, 
            storage_path: filePath 
          })
          .select("id")
          .single();

        if (insertSourceError) {
          console.error(`Insert source error for ${file.name}:`, insertSourceError);
          showError(`Failed to register source ${file.name}: ${insertSourceError.message}`);
          return null;
        }

        console.log(`File ${file.name} processed, source ID: ${sourceData.id}`);
        return sourceData.id;
      });

      const newFileSourceIds = (await Promise.all(fileProcessingPromises)).filter(Boolean) as string[];
      allSourceIdsForLLM.push(...newFileSourceIds);

      // 4. Process new URLs
      const urlProcessingPromises = filteredUrls.map(async (url) => {
        console.log(`Adding URL source: ${url}`);
        const { data: sourceData, error: insertSourceError } = await supabase
          .from("sources")
          .insert({ 
            chat_id: currentChat, 
            user_id: userId, 
            type: "url", 
            name: url 
          })
          .select("id")
          .single();

        if (insertSourceError) {
          console.error(`Insert source error for URL ${url}:`, insertSourceError);
          showError(`Failed to register URL ${url}: ${insertSourceError.message}`);
          return null;
        }

        console.log(`URL ${url} processed, source ID: ${sourceData.id}`);
        return sourceData.id;
      });

      const newUrlSourceIds = (await Promise.all(urlProcessingPromises)).filter(Boolean) as string[];
      allSourceIdsForLLM.push(...newUrlSourceIds);

      // 5. Deduplicate and prepare for LLM
      allSourceIdsForLLM = Array.from(new Set(allSourceIdsForLLM));
      console.log("Final source IDs being sent to LLM:", allSourceIdsForLLM);

      const conversationHistoryForLLM = messages.slice(-10).map(msg => ({
        role: msg.role,
        content: msg.content,
      }));

      // 6. Invoke Edge Function
      console.log("Invoking ask-llm Edge Function...");
      const { data, error: edgeFunctionError } = await supabase.functions.invoke("ask-llm", {
        body: {
          question: trimmedQuestion,
          sourceIds: allSourceIdsForLLM,
          messages: conversationHistoryForLLM,
        },
      });

      if (edgeFunctionError || data?.error) {
        console.error("Edge Function error:", edgeFunctionError || data?.error);
        throw new Error(edgeFunctionError?.message || data?.error || "Unknown error from AI function");
      }

      const assistantResponseContent = data.response || "No response from LLM.";
      console.log("Received assistant response.");

      // 7. Add assistant message to UI and DB
      const assistantMessage: Message = {
        id: crypto.randomUUID(),
        content: assistantResponseContent,
        role: "assistant",
        created_at: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, assistantMessage]);

      const { error: assistantMsgError } = await supabase
        .from("messages")
        .insert({ chat_id: currentChat, user_id: userId, content: assistantResponseContent, role: "assistant" });
      
      if (assistantMsgError) {
        console.error("Error saving assistant message:", assistantMsgError);
      }

      // 8. Reset inputs
      setQuestion("");
      setFiles([]);
      setUrls([""]);
      showSuccess("Response received!");

    } catch (error: any) {
      console.error("Chat submission error:", error);
      showError(`Failed to get response: ${error.message}`);
    } finally {
      setIsLoadingResponse(false);
    }
  };

  if (isSessionLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100 dark:bg-gray-900">
        <Loader2 className="h-8 w-8 animate-spin text-gray-600 dark:text-gray-400" />
      </div>
    );
  }

  const isGuest = session?.user?.email === 'guest@example.com';

  return (
    <div className="min-h-screen flex flex-col items-center justify-between bg-gray-100 dark:bg-gray-900 p-4">
      <Card className="w-full max-w-2xl bg-white dark:bg-gray-800 shadow-lg rounded-lg flex flex-col h-[90vh]">
        <CardHeader className="pb-4 relative flex items-center justify-between">
          <CardTitle
            className="text-3xl font-bold"
            style={{ color: secondaryAccentColor }}
          >
            Smart Chat
          </CardTitle>
          <div className="flex items-center space-x-2">
            {currentChatId && (
              <Dialog open={isSourcesDialogOpen} onOpenChange={setIsSourcesDialogOpen}>
                <DialogTrigger asChild>
                  <Button variant="outline" size="sm">
                    <FileText className="h-4 w-4 mr-2" /> Sources
                  </Button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-[600px] max-h-[80vh] overflow-y-auto dark:bg-gray-800">
                  <DialogHeader>
                    <DialogTitle>Chat Sources</DialogTitle>
                  </DialogHeader>
                  <SourceDisplay chatId={currentChatId} />
                </DialogContent>
              </Dialog>
            )}
            {isGuest ? (
              <Button variant="outline" size="sm" onClick={() => navigate('/login')}>
                <User className="h-4 w-4 mr-2" /> Login
              </Button>
            ) : (
              <Button variant="outline" size="sm" onClick={handleLogout}>
                <LogOut className="h-4 w-4 mr-2" /> Logout
              </Button>
            )}
          </div>
        </CardHeader>
        <div className="flex-grow flex flex-col overflow-hidden">
          <ScrollArea className="flex-grow px-6 pt-6 pb-4 border-t border-b dark:border-gray-700">
            <div className="space-y-4">
              {messages.length === 0 && (
                <div className="text-center text-gray-500">
                  Ask a question or upload a file to start.
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
                    <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                  </div>
                  {msg.role === "user" && (
                    <Avatar>
                      <AvatarFallback style={{ backgroundColor: primaryAccentColor, color: secondaryAccentColor }}>
                        {session?.user?.email ? session.user.email[0].toUpperCase() : "U"}
                      </AvatarFallback>
                    </Avatar>
                  )}
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>
          </ScrollArea>

          <form onSubmit={handleSubmit} className="p-6 space-y-4 border-t dark:border-gray-700 flex-shrink-0">
            <Textarea
              placeholder="Type your question here..."
              value={question}
              onChange={handleQuestionChange}
              rows={2}
              className="w-full p-3 border rounded-md dark:bg-gray-700 dark:text-white"
              disabled={isLoadingResponse}
            />

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label className="text-xs font-medium mb-1 block">Upload Files</Label>
                <Input
                  type="file"
                  multiple
                  onChange={handleFileChange}
                  className="h-auto py-1.5 text-xs cursor-pointer"
                  disabled={isLoadingResponse}
                />
                <div className="mt-1 flex flex-wrap gap-1">
                  {files.map((file, index) => (
                    <div key={index} className="flex items-center bg-gray-100 dark:bg-gray-700 px-2 py-1 rounded text-[10px]">
                      <span className="truncate max-w-[100px]">{file.name}</span>
                      <X className="h-3 w-3 ml-1 cursor-pointer text-red-500" onClick={() => handleRemoveFile(index)} />
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <Label className="text-xs font-medium mb-1 block">Add URLs</Label>
                <div className="space-y-1">
                  {urls.map((url, index) => (
                    <div key={index} className="flex items-center space-x-1">
                      <Input
                        type="url"
                        placeholder="https://..."
                        value={url}
                        onChange={(e) => handleUrlChange(index, e.target.value)}
                        className="h-8 text-xs"
                        disabled={isLoadingResponse}
                      />
                      {urls.length > 1 && (
                        <X className="h-4 w-4 cursor-pointer text-red-500" onClick={() => handleRemoveUrl(index)} />
                      )}
                    </div>
                  ))}
                  <Button type="button" onClick={handleAddUrl} variant="ghost" className="h-6 text-[10px] w-full" disabled={isLoadingResponse}>
                    + Add URL
                  </Button>
                </div>
              </div>
            </div>

            <Button
              type="submit"
              className="w-full py-2 font-semibold"
              style={{ backgroundColor: primaryAccentColor, color: "#030816" }}
              disabled={isLoadingResponse}
            >
              {isLoadingResponse ? <Loader2 className="h-4 w-4 animate-spin" /> : "Submit"}
            </Button>
          </form>
        </div>
      </Card>
      <MadeWithDyad />
    </div>
  );
};

export default ChatPage;