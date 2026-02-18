import axios from "axios";

interface SendWhatsAppTextParams {
  accessToken: string;
  phoneNumberId: string;
  to: string;
  body: string;
}

export function maskPhone(phone: string): string {
  if (phone.length <= 4) return "****";
  const head = phone.slice(0, 2);
  const tail = phone.slice(-2);
  return `${head}${"*".repeat(Math.max(2, phone.length - 4))}${tail}`;
}

export async function sendWhatsAppText(params: SendWhatsAppTextParams): Promise<void> {
  const url = `https://graph.facebook.com/v20.0/${params.phoneNumberId}/messages`;

  await axios.post(
    url,
    {
      messaging_product: "whatsapp",
      to: params.to,
      type: "text",
      text: { body: params.body },
    },
    {
      headers: {
        Authorization: `Bearer ${params.accessToken}`,
        "Content-Type": "application/json",
      },
      timeout: 10000,
    },
  );
}
