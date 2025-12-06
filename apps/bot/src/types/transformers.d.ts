declare module "@huggingface/transformers"
{
    export const env: {
        cacheDir?: string;
        allowLocalModels?: boolean;
    };

    export interface TextGenerationOutput
    {
        generated_text?: string
    }

    export interface TextGenerationPipeline
    {
        (prompt: string, options?: Record<string, unknown>): Promise<TextGenerationOutput | TextGenerationOutput[]>;
    }

    export function pipeline(task: "text-generation", model: string, options?: Record<string, unknown>): Promise<TextGenerationPipeline>;
}