declare module "google-news-url-decoder" {
  type DecodeResult =
    | {
        status: true;
        source_url?: string;
        decoded_url: string;
      }
    | {
        status: false;
        source_url?: string;
        message: string;
      };

  interface GoogleDecoderInstance {
    decode(sourceUrl: string): Promise<DecodeResult>;
    decodeBatch(sourceUrls: string[]): Promise<DecodeResult[]>;
  }

  const decoderModule: {
    GoogleDecoder: new () => GoogleDecoderInstance;
  };
  export default decoderModule;
}
