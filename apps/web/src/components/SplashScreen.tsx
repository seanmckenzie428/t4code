import { PRODUCT_NAME } from "@t3tools/shared/branding";

export function SplashScreen() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div
        className="flex size-24 items-center justify-center"
        aria-label={`${PRODUCT_NAME} splash screen`}
      >
        <img alt={PRODUCT_NAME} className="size-16 object-contain" src="/apple-touch-icon.png" />
      </div>
    </div>
  );
}
